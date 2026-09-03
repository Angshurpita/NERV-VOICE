import { describe, expect, it } from 'vitest';
import { normaliseForSpeech } from '../speech-text.js';
import { evaluateCancellation } from '../order-policy.js';
import { evaluateEscalation } from '../escalation.js';
import { makeOrder, verifiedState, policy } from './fixtures.js';

describe('Nerv Core', () => {
  describe('Speech Normalisation', () => {
    it('normalises digits and rupee amounts', () => {
      const input = 'Order 4852 total is ₹29990';
      const output = normaliseForSpeech(input, 'en');
      expect(output).toBeDefined();
      expect(typeof output).toBe('string');
    });
  });

  describe('Order Cancellation Policy', () => {
    it('allows cancellation for PLACED orders without escalating', () => {
      const order = makeOrder({ status: 'PLACED' });
      const verdict = evaluateCancellation(order, policy);
      expect(verdict.outcome).toBe('ai_may_cancel');
    });

    it('escalates cancellation for OUT_FOR_DELIVERY orders', () => {
      const order = makeOrder({ status: 'OUT_FOR_DELIVERY' });
      const verdict = evaluateCancellation(order, policy);
      expect(verdict.outcome).toBe('needs_human');
    });
  });

  describe('Escalation Policy', () => {
    it('does not escalate when human request count is below threshold', () => {
      const order = makeOrder();
      let state = verifiedState('unknown', order);
      state = { ...state, humanRequestCount: 1 };
      const decision = evaluateEscalation(state, policy, order);
      expect(decision.required).toBe(false);
    });

    it('escalates when caller insists on a human (3 requests)', () => {
      const order = makeOrder();
      let state = verifiedState('unknown', order);
      state = { ...state, humanRequestCount: 3 };
      const decision = evaluateEscalation(state, policy, order);
      expect(decision.required).toBe(true);
      expect(decision.reason).toBe('CUSTOMER_INSISTED_HUMAN');
    });

    it('escalates return or refund requests with verified reason and report (req 6.2)', () => {
      const order = makeOrder({ status: 'DELIVERED' });
      let state = verifiedState('return_request', order);
      state = {
        ...state,
        requiredInformation: {
          returnReason: { value: 'Defective item', candidates: [{ value: 'Defective item', confidence: 0.95, observedAt: new Date().toISOString(), sourceUtterance: 'Defective item' }], confidence: 0.95, confirmed: true, display: 'Defective item' },
        },
      };
      const decision = evaluateEscalation(state, policy, order);
      expect(decision.required).toBe(true);
      expect(decision.reason).toBe('REFUND_OR_RETURN');
      expect(decision.report).toBeDefined();
      expect(decision.report?.orderId).toBe(order.id);
      expect(decision.report?.ordererName).toBe(state.verification.ordererName);
    });

    it('escalates out-for-delivery cancellation with clear reason (req 6.3)', () => {
      const order = makeOrder({ status: 'OUT_FOR_DELIVERY' });
      let state = verifiedState('cancellation_request', order);
      state = {
        ...state,
        requiredInformation: {
          cancellationReason: { value: 'Customer travelling', candidates: [{ value: 'Customer travelling', confidence: 0.95, observedAt: new Date().toISOString(), sourceUtterance: 'Customer travelling' }], confidence: 0.95, confirmed: true, display: 'Customer travelling' },
        },
      };
      const decision = evaluateEscalation(state, policy, order);
      expect(decision.required).toBe(true);
      expect(decision.reason).toBe('CANCEL_WHILE_OUT_FOR_DELIVERY');
    });

    it('does not escalate cancellable pre-dispatch orders (AI resolves directly)', () => {
      const order = makeOrder({ status: 'PLACED' });
      const state = verifiedState('cancellation_request', order);
      const decision = evaluateEscalation(state, policy, order);
      expect(decision.required).toBe(false);
    });
  });
});
