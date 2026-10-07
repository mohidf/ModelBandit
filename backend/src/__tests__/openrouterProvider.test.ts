/**
 * Tests for the error OpenRouterProvider throws when the API rejects a call.
 * The SDK is mocked: only the error wrapping is under test.
 */

const mockCreate = jest.fn();

jest.mock('openai', () => {
  class APIError extends Error {
    constructor(readonly status: number, message: string) {
      super(message);
    }
  }
  class OpenAI {
    static APIError = APIError;
    chat = { completions: { create: mockCreate } };
  }
  return { __esModule: true, default: OpenAI };
});

import OpenAI from 'openai';
import { OpenRouterProvider } from '../providers/openrouterProvider';

const apiError = (status: number, message: string): Error =>
  new (OpenAI.APIError as unknown as new (s: number, m: string) => Error)(status, message);

const call = () =>
  new OpenRouterProvider().generate('hi', 'meta-llama/llama-3.1-8b-instruct', {
    maxTokens: 16, tier: 'cheap', apiKey: 'test-key',
  });

describe('OpenRouterProvider API errors', () => {
  it('keeps the model and status in the message', async () => {
    mockCreate.mockRejectedValueOnce(apiError(402, 'Insufficient credits'));
    await expect(call()).rejects.toThrow(
      'OpenRouterProvider [meta-llama/llama-3.1-8b-instruct]: API error 402 — Insufficient credits',
    );
  });

  it('carries the HTTP status on the thrown error so callers can tell account problems from model failures', async () => {
    mockCreate.mockRejectedValueOnce(apiError(401, 'Invalid key'));
    await expect(call()).rejects.toMatchObject({ status: 401 });
  });

  it('rethrows non-API errors unchanged', async () => {
    const boom = new Error('socket hang up');
    mockCreate.mockRejectedValueOnce(boom);
    await expect(call()).rejects.toBe(boom);
  });
});
