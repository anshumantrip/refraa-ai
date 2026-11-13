import os
import re
import secrets
from collections import OrderedDict
from contextlib import asynccontextmanager
from threading import Lock

from fastapi import FastAPI, Header, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, StringConstraints
from sentence_transformers import SentenceTransformer
from typing import Annotated


@asynccontextmanager
async def lifespan(app):
    app.state.secret = os.environ["MATCH_AI_TOKEN"]
    if len(app.state.secret) < 32:
        raise RuntimeError("MATCH_AI_TOKEN must contain at least 32 characters")
    app.state.name = os.getenv("MATCH_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    app.state.revision = os.getenv("MATCH_MODEL_REVISION", "c9745ed1d9f207416be6d2e6f8de32d1f16199bf")
    if not re.fullmatch("[a-f0-9]{40}", app.state.revision):
        raise RuntimeError("MATCH_MODEL_REVISION must be a full commit hash")
    app.state.model = SentenceTransformer(
        app.state.name, revision=app.state.revision, device=os.getenv("MATCH_DEVICE", "cpu"),
        trust_remote_code=False, model_kwargs={"use_safetensors": True},
        local_files_only=os.getenv("MATCH_MODEL_OFFLINE", "false") == "true",
    )
    app.state.cache = OrderedDict()
    app.state.lock = Lock()
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

@app.exception_handler(RequestValidationError)
async def invalid_input(_request, _error):
    return JSONResponse(status_code=422, content={"detail": "Invalid embedding input"})


@app.get("/health")
def health():
    return {"status": "ready"}


class EmbeddingInput(BaseModel):
    texts: list[Annotated[str, StringConstraints(min_length=1, max_length=900)]] = Field(
        min_length=1, max_length=64
    )


@app.post("/embed")
def embed(payload: EmbeddingInput, authorization: Annotated[str | None, Header()] = None):
    if not secrets.compare_digest(
        (authorization or "").encode(), ("Bearer " + app.state.secret).encode()
    ):
        raise HTTPException(401, "Unauthorized")
    with app.state.lock:
        cache = app.state.cache
        missing = list(dict.fromkeys(text for text in payload.texts if text not in cache))
        if missing:
            vectors = app.state.model.encode(
                missing, batch_size=32, normalize_embeddings=True, show_progress_bar=False
            )
            for text, vector in zip(missing, vectors, strict=True):
                cache[text] = vector.tolist()
        result = [cache[text] for text in payload.texts]
        for text in payload.texts:
            cache.move_to_end(text)
        while len(cache) > 4096:
            cache.popitem(last=False)
    return {"model": app.state.name, "revision": app.state.revision, "vectors": result}
