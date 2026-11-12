import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { Field, Form, Heading, Notice, Submit, useAction } from './ui.jsx';

export function Login({ onLogin }) {
  const action = useAction();
  const navigate = useNavigate();
  const { state } = useLocation();
  return <>
    <Heading title="Sign in to refraaAI" description="Use your work email to access your workspace." />
    <Notice message={state?.message} />
    <Form action={action} onSubmit={async values => {
      const result = await action.run(() => api('/auth/login', { method: 'POST', body: values }), error => {
        if (error.code === 'EMAIL_UNVERIFIED') navigate('/verify', { state: { email: values.email } });
      });
      if (result) { onLogin(result.user); navigate('/companies'); }
    }}>
      <Field label="Work email" name="email" type="email" autoComplete="username" defaultValue={state?.email} />
      <Field label="Password" name="password" type="password" autoComplete="current-password" />
      <Link className="form-link" to="/forgot">Forgot password?</Link>
      <Submit busy={action.busy}>Sign in</Submit>
    </Form>
    <p className="footnote">New to refraaAI? <Link to="/register">Create an account</Link></p>
    <p className="footnote"><Link to="/verify">Verify your email</Link></p>
  </>;
}

function PasswordFields() {
  return <>
    <Field label="Password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={72} aria-describedby="password-help" />
    <p className="muted field-help" id="password-help">Use at least 12 characters.</p>
    <Field label="Confirm password" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={72} />
  </>;
}

export function Register() {
  const action = useAction();
  const navigate = useNavigate();
  return <>
    <Heading title="Create your account" description="Get started with your work email." />
    <Form action={action} onSubmit={async values => {
      const result = await action.run(() => api('/auth/register', { method: 'POST', body: values }), error => {
        if (error.code === 'EMAIL_DELIVERY_FAILED') navigate('/verify', { state: { email: values.email, error: error.message, resendAfter: 45 } });
      });
      if (result) navigate('/verify', { state: { email: result.email, resendAfter: result.resendAfter } });
    }}>
      <Field label="Full name" name="name" autoComplete="name" minLength={2} maxLength={100} />
      <Field label="Work email" name="email" type="email" autoComplete="email" />
      <PasswordFields />
      <Submit busy={action.busy}>Create account</Submit>
    </Form>
    <p className="footnote">Already registered? <Link to="/login">Sign in</Link> · <Link to="/verify">Verify email</Link></p>
  </>;
}

function OtpInput({ digits, setDigits, focusFirst }) {
  const inputs = useRef([]);
  useEffect(() => { if (focusFirst) inputs.current[0]?.focus(); }, [focusFirst]);
  function insert(index, value) {
    const numbers = value.replace(/\D/g, '').slice(0, 6);
    if (!numbers) {
      setDigits(previous => previous.map((digit, position) => position === index ? '' : digit));
      return;
    }
    const start = numbers.length === 6 ? 0 : index;
    setDigits(previous => previous.map((digit, position) => numbers[position - start] ?? digit));
    inputs.current[Math.min(start + numbers.length, 5)]?.focus();
  }
  return <fieldset className="otp-group"><legend>Verification code</legend><div className="otp-row">
    {digits.map((digit, index) => <input key={index} ref={node => { inputs.current[index] = node; }}
      data-otp-input inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'}
      aria-label={'Digit ' + (index + 1)} value={digit}
      onFocus={event => event.currentTarget.select()}
      onChange={event => insert(index, event.currentTarget.value)}
      onPaste={event => { event.preventDefault(); insert(index, event.clipboardData.getData('text')); }}
      onKeyDown={event => {
        if (event.key === 'Backspace' && !digit && index > 0) {
          event.preventDefault(); insert(index - 1, ''); inputs.current[index - 1]?.focus();
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault(); inputs.current[index + (event.key === 'ArrowLeft' ? -1 : 1)]?.focus();
        }
      }} />)}
  </div></fieldset>;
}

export function Verify() {
  const { state } = useLocation();
  const [email, setEmail] = useState(state?.email || '');
  const [digits, setDigits] = useState(() => Array(6).fill(''));
  const [remaining, setRemaining] = useState(state?.resendAfter || 0);
  const action = useAction();
  const resend = useAction();
  const navigate = useNavigate();
  const cooldownActive = remaining > 0;
  useEffect(() => {
    if (!cooldownActive) return;
    const timer = setInterval(() => setRemaining(value => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldownActive]);
  return <>
    <Heading title="Check your inbox" description="Enter the six-digit code sent to your work email." />
    {state?.error && !resend.message && <Notice error={state.error} />}
    <Form action={action} onSubmit={async ({ password }) => {
      const result = await action.run(() => api('/auth/verify', { method: 'POST', body: { email, password, code: digits.join('') } }));
      if (result) navigate('/login', { state: { email, message: result.message } });
    }}>
      <Field label="Work email" name="email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} />
      <OtpInput digits={digits} setDigits={setDigits} focusFirst={Boolean(state?.email)} />
      <Field label="Account password" name="password" type="password" autoComplete="current-password" />
      <Submit busy={action.busy || resend.busy} disabled={action.busy || resend.busy || digits.some(digit => !digit)}>Verify email</Submit>
    </Form>
    <Notice error={resend.error} message={resend.message} />
    <div className="footnote">
      <button type="button" className="text-button" disabled={!email || remaining > 0 || resend.busy || action.busy}
        onClick={async () => {
          const result = await resend.run(() => api('/auth/resend', { method: 'POST', body: { email } }), error => {
            if (error.code === 'OTP_COOLDOWN' || error.code === 'EMAIL_DELIVERY_FAILED') setRemaining(45);
          });
          if (result) { setDigits(Array(6).fill('')); setRemaining(result.resendAfter); }
        }}>{remaining > 0 ? 'Resend in ' + remaining + 's' : 'Resend code'}</button>
      {' · '}<Link to="/forgot">Reset password</Link>{' · '}<Link to="/login">Back to sign in</Link>
    </div>
  </>;
}

export function Recovery({ reset = false }) {
  const action = useAction();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const token = new URLSearchParams(hash.slice(1)).get('token');
  const invalid = reset && !/^[a-f0-9]{64}$/.test(token || '');
  return <>
    <Heading title={reset ? 'Choose a new password' : 'Reset your password'}
      description={reset ? 'Your existing sessions will be signed out.' : 'We’ll send a reset link to your work email.'} />
    {invalid ? <><Notice error="This reset link is invalid." /><Link to="/forgot">Request a new link</Link></> :
      <Form action={action} onSubmit={async values => {
        const result = await action.run(() => api('/auth/' + (reset ? 'reset' : 'forgot'),
          { method: 'POST', body: reset ? { ...values, token } : values }));
        if (result && reset) navigate('/login', { replace: true, state: { message: result.message } });
      }}>
        {reset ? <PasswordFields /> : <Field label="Work email" name="email" type="email" autoComplete="email" />}
        <Submit busy={action.busy}>{reset ? 'Change password' : 'Send reset link'}</Submit>
      </Form>}
    <p className="footnote"><Link to="/login">Back to sign in</Link></p>
  </>;
}
