import { describe, expect, it } from 'vitest';
import { parseDateIso, stripQuotedHistory } from './mailFormat.js';

describe('stripQuotedHistory', () => {
  it('cuts at a Gmail "On ... wrote:" quote block', () => {
    const body =
      'Hi Mike,\n\nWe’ve completed the mock-ups, please take a look.\n\nThanks,\nAlice\n\n' +
      'On Mon, Oct 28, 2024 at 9:55 AM Mike Miller <mike@example.com> wrote:\n' +
      '> Can you send the mock-ups over?\n> Thanks\n';
    expect(stripQuotedHistory(body)).toBe(
      'Hi Mike,\n\nWe’ve completed the mock-ups, please take a look.\n\nThanks,\nAlice',
    );
  });

  it('cuts at nested quote layers, keeping only the newest reply', () => {
    const body =
      'Sounds good, approved.\n\n' +
      'On Tue, Jan 2, 2024 Alice <alice@example.com> wrote:\n' +
      'Here is the revised draft.\n\n' +
      'On Mon, Jan 1, 2024 Bob <bob@example.com> wrote:\n' +
      'Please revise the draft.\n';
    expect(stripQuotedHistory(body)).toBe('Sounds good, approved.');
  });

  it('cuts at an Outlook "-----Original Message-----" block', () => {
    const body = 'Approved, go ahead.\n\n-----Original Message-----\nFrom: Bob\nSent: Monday\nPlease approve.';
    expect(stripQuotedHistory(body)).toBe('Approved, go ahead.');
  });

  it('cuts at a forwarded-message marker', () => {
    const body = 'FYI, see below.\n\n---------- Forwarded message ---------\nFrom: Carol\nOriginal content here.';
    expect(stripQuotedHistory(body)).toBe('FYI, see below.');
  });

  it('cuts at an Outlook From/Sent/To/Subject reply header block', () => {
    const body =
      'Looks good to me.\n\nFrom: Dana Lee\nSent: Tuesday, March 4\nTo: Team\nSubject: Q1 numbers\n\nDraft attached.';
    expect(stripQuotedHistory(body)).toBe('Looks good to me.');
  });

  it('cuts at leading ">" quoted lines', () => {
    const body = 'Agreed.\n\n> Should we proceed?\n> Let me know.';
    expect(stripQuotedHistory(body)).toBe('Agreed.');
  });

  it('returns the body unchanged (trimmed) when there is no quote marker', () => {
    expect(stripQuotedHistory('Just a plain one-off message.\n\n')).toBe('Just a plain one-off message.');
  });
});

describe('parseDateIso', () => {
  it('parses an RFC 2822 email date header to ISO 8601', () => {
    expect(parseDateIso('Mon, 28 Oct 2024 09:55:00 -0700')).toBe('2024-10-28T16:55:00.000Z');
  });

  it('returns null for unparseable input', () => {
    expect(parseDateIso('not a date')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseDateIso('')).toBeNull();
  });
});
