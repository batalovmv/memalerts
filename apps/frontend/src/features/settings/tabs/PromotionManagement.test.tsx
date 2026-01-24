import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { PromotionManagement } from './PromotionManagement';
import { renderWithProviders } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import { mockStreamerPromotionCreateOk, mockStreamerPromotionPatchOk } from '@/test/msw/handlers';

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('PromotionManagement (integration)', () => {
  it('loads promotions and toggles active (PATCH + refresh)', async () => {
    const user = userEvent.setup();

    type Promotion = {
      id: string;
      name: string;
      discountPercent: number;
      startDate: string;
      endDate: string;
      isActive: boolean;
    };
    let promotions: Promotion[] = [
      {
        id: 'p1',
        name: 'Promo',
        discountPercent: 10,
        startDate: new Date('2025-01-01T00:00:00.000Z').toISOString(),
        endDate: new Date('2026-01-01T00:00:00.000Z').toISOString(),
        isActive: false,
      },
    ];

    const listCalls = vi.fn();
    const patchAssert = vi.fn();

    server.use(
      http.get('*/streamer/promotions', () => {
        listCalls();
        return HttpResponse.json(promotions);
      }),
      mockStreamerPromotionPatchOk(({ id, body }) => {
        patchAssert({ id, body });
        promotions = promotions.map((p) => (p.id === id ? { ...p, isActive: !p.isActive } : p));
      }),
    );

    renderWithProviders(<PromotionManagement />, { route: '/settings?tab=promotions' });

    expect(await screen.findByText('Promo')).toBeInTheDocument();
    await waitFor(() => expect(listCalls).toHaveBeenCalledTimes(1));

    // Click Activate -> PATCH -> reload GET.
    await user.click(screen.getByRole('button', { name: /activate/i }));

    await waitFor(() => expect(patchAssert).toHaveBeenCalledWith({ id: 'p1', body: { isActive: true } }));
    await waitFor(() => expect(listCalls).toHaveBeenCalledTimes(2));

    // Now the card should show "Active" status pill.
    expect(await screen.findByText(/^active$/i)).toBeInTheDocument();
  });

  it('creates a promotion (POST) and refreshes list', async () => {
    const user = userEvent.setup();

    type Promotion = {
      id: string;
      name: string;
      discountPercent: number;
      startDate: string;
      endDate: string;
      isActive: boolean;
    };
    type PromotionPayload = {
      name: string;
      discountPercent: number;
      startDate: string;
      endDate: string;
    };
    let promotions: Promotion[] = [];
    const createBody = vi.fn();
    const listCalls = vi.fn();

    server.use(
      http.get('*/streamer/promotions', () => {
        listCalls();
        return HttpResponse.json(promotions);
      }),
      mockStreamerPromotionCreateOk((body) => {
        createBody(body);
        const payload = body as PromotionPayload;
        promotions = [
          {
            id: 'p_new',
            name: payload.name,
            discountPercent: payload.discountPercent,
            startDate: payload.startDate,
            endDate: payload.endDate,
            isActive: true,
          },
        ];
      }),
    );

    renderWithProviders(<PromotionManagement />, { route: '/settings?tab=promotions' });

    await waitFor(() => expect(listCalls).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/no promotions/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /create promotion/i }));

    const nameInput = screen.getByRole('textbox');
    await user.type(nameInput, 'New Promo');

    const discountInput = screen.getByRole('spinbutton');
    await user.clear(discountInput);
    await user.type(discountInput, '12.5');

    // datetime-local inputs
    const dateLocals = Array.from(document.querySelectorAll('input[type="datetime-local"]')) as HTMLInputElement[];
    const [start, end] = dateLocals;
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();
    await user.type(start!, '2025-01-01T10:00');
    await user.type(end!, '2025-01-02T10:00');

    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(createBody).toHaveBeenCalledTimes(1));
    const body = createBody.mock.calls[0]![0] as PromotionPayload;
    expect(body.name).toBe('New Promo');
    expect(body.discountPercent).toBe(12.5);
    expect(typeof body.startDate).toBe('string');
    expect(String(body.startDate)).toMatch(/Z$/);
    expect(typeof body.endDate).toBe('string');
    expect(String(body.endDate)).toMatch(/Z$/);
    expect(Number.isNaN(Date.parse(body.startDate))).toBe(false);
    expect(Number.isNaN(Date.parse(body.endDate))).toBe(false);

    await waitFor(() => expect(listCalls).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('New Promo')).toBeInTheDocument();
  });
});

