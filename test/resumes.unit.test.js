import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractText, inspectFile, pdfMime, docxMime, safeFilename } from '../server/resumes/file.js';
import { parseResume } from '../server/resumes/parse.js';
import { resumeConfig } from '../server/resumes/config.js';
import { docxFixture, pdfFixture } from './resume-fixtures.js';

for (const [name, make, mime] of [['fixture.pdf', pdfFixture, pdfMime], ['fixture.docx', docxFixture, docxMime]]) {
  test('extracts grounded profile data from ' + name, async () => {
    const bytes = make();
    assert.equal(await inspectFile(bytes, name), mime);
    const { data, evidence } = parseResume(await extractText(bytes, mime));
    assert.equal(data.name, 'Test Candidate');
    assert.equal(data.email, 'candidate@fixture.example');
    assert.equal(data.phone, '+15550100199');
    assert.deepEqual(data.skills, ['React', 'SQL']);
    assert.equal(data.education[0].cgpa, 3.7);
    assert.equal(data.education[0].scale, 4);
    assert.equal(data.education[0].percentage, null);
    assert.equal(data.projects[0].description, 'Built a REST service');
    assert.equal(data.experience[0].startDate, 'Jan 2020');
    assert.equal(data.experience[0].duration, '26 months');
    assert.equal(data.internships.length, 1);
    assert.equal(data.certifications.length, 1);
    assert.match(evidence.education[0].excerpt, /CGPA: 3.7\/4/);
  });
}

test('rejects mismatched, corrupt, encrypted, empty, and unsafe documents', async () => {
  await assert.rejects(inspectFile(pdfFixture(), 'resume.docx'), /signature/);
  await assert.rejects(inspectFile(Buffer.from('PK\x03\x04fake'), 'resume.docx'), /corrupt/);
  await assert.rejects(extractText(Buffer.from('%PDF-1.4\nbad'), pdfMime), /corrupt/);
  await assert.rejects(extractText(pdfFixture([], { encrypted: true }), pdfMime), /Password-protected/);
  await assert.rejects(extractText(pdfFixture([]), pdfMime), { status: 'ocr_required' });
  await assert.rejects(extractText(docxFixture([]), docxMime), /No readable text/);
  await assert.rejects(extractText(docxFixture([], '<!DOCTYPE w:document>'), docxMime), /document types/);
});

test('keeps unavailable fields unknown and does not convert CGPA', () => {
  const { data } = parseResume('Education\nExample College, CGPA 7.2\n78%\nProjects\nAn experiment');
  assert.equal(data.name, null);
  assert.equal(data.email, null);
  assert.equal(data.education[0].scale, null);
  assert.equal(data.education[1].percentage, 78);
  assert.equal(data.projects[0].startDate, null);
  assert.equal(safeFilename('..\\file.pdf'), 'file.pdf');
  assert.throws(() => resumeConfig({ RESUME_FILE_MB: '0' }), /RESUME_FILE_MB/);
});
