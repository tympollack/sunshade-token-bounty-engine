import { describe, it, expect, vi } from 'vitest';
import { BountyEngineClient } from '../src/client/bountyEngineClient';

describe('BountyEngineClient SDK Tests', () => {
  it('calls health endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', service: 'sunshade-token-bounty-engine', version: '1.0.0' }),
    });

    const client = new BountyEngineClient({
      baseUrl: 'http://localhost:4000',
      fetchFn: mockFetch as any,
    });

    const health = await client.getHealth();
    expect(health.status).toBe('ok');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/health',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('passes authentication headers and quotes bounty rates', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        quote: {
          baseHours: 2.0,
          hourlyTokenRate: 60000,
          bountyTokens: 120000,
          neglectMultiplier: 1.0,
        },
      }),
    });

    const client = new BountyEngineClient({
      baseUrl: 'http://localhost:4000',
      apiKey: 'test-secret-key',
      fetchFn: mockFetch as any,
    });

    const { quote } = await client.getQuote({ bounty_hours: 2.0 });
    expect(quote.bountyTokens).toBe(120000);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/bounties/quote?bounty_hours=2'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-secret-key',
          'x-api-key': 'test-secret-key',
        }),
      })
    );
  });

  it('handles client errors gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        error: 'Runner weekly capacity exceeded.',
      }),
    });

    const client = new BountyEngineClient({
      baseUrl: 'http://localhost:4000',
      fetchFn: mockFetch as any,
    });

    await expect(
      client.claimBounty({
        claimantUserId: 'usr-1',
        newTaskHours: 10.0,
      })
    ).rejects.toThrow('Runner weekly capacity exceeded.');
  });
});
