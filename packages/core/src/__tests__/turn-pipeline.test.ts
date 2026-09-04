import { describe, expect, it, vi } from 'vitest';
import { runTurn, greeting } from '../turn.js';
import { createState } from '../conversation-state.js';
import { normaliseForSpeech } from '../speech-text.js';
import {
  makeCustomer,
  makeOrder,
  verifiedState,
  policy,
  fixedClock,
} from './fixtures.js';

describe('EchoSphere Turn Pipeline & Conversational AI', () => {
  describe('Greetings', () => {
    it('provides English greeting by default', () => {
      const g = greeting('en');
      expect(g).toContain('How can I help');
    });

    it('provides Hindi greeting when hi is requested', () => {
      const g = greeting('hi');
      expect(g).toContain('नमस्ते');
    });
  });

  describe('Deterministic Turn Execution & Language Adaptation', () => {
    it('processes Hindi caller speech and extracts order ID', async () => {
      const order = makeOrder({ id: '4852', status: 'DELAYED' });
      const customer = makeCustomer();
      const initialState = createState('call_hindi_1', {}, fixedClock);

      const lookupOrderMock = vi.fn().mockResolvedValue({
        outcome: 'found',
        order,
        customer,
      });

      const callModelMock = vi.fn().mockResolvedValue({
        spoken: 'हाँ, मुझे आपका ऑर्डर 4852 मिल गया है। यह देरी से चल रहा है।',
        plain: 'Order 4852 found and delayed',
      });

      const result = await runTurn(
        {
          state: initialState,
          utterance: 'नमस्ते मेरा ऑर्डर 4852 कहाँ है',
          asrConfidence: 0.96,
          history: [],
        },
        {
          policy,
          lookupOrder: lookupOrderMock,
          callModel: callModelMock,
          clock: fixedClock,
        },
      );

      expect(lookupOrderMock).toHaveBeenCalledWith('4852');
      expect(callModelMock).toHaveBeenCalled();
      expect(result.language).toBe('hi');
      expect(result.reply).toBeDefined();
      expect(result.state.language.primary).toBe('hi');
      expect(result.state.verification.orderId).toBe('4852');
    });

    it('escalates cancellation for out-for-delivery orders during turn execution', async () => {
      const order = makeOrder({ id: '4852', status: 'OUT_FOR_DELIVERY' });
      const state = verifiedState('cancellation_request', order);

      const lookupOrderMock = vi.fn().mockResolvedValue({
        outcome: 'found',
        order,
        customer: makeCustomer(),
      });

      const callModelMock = vi.fn().mockResolvedValue({
        spoken: 'I understand you want to cancel, but since your order is out for delivery, I am connecting you to an agent.',
        plain: 'Escalating to human agent.',
      });

      const result = await runTurn(
        {
          state,
          utterance: 'I need to cancel this order right now, I am travelling',
          asrConfidence: 0.95,
          history: [{ speaker: 'agent', text: 'How can I help?' }],
        },
        {
          policy,
          lookupOrder: lookupOrderMock,
          callModel: callModelMock,
          clock: fixedClock,
        },
      );

      expect(result.escalated).toBe(true);
      expect(result.escalation?.reason).toBe('CANCEL_WHILE_OUT_FOR_DELIVERY');
    });
  });

  describe('Session Isolation between Concurrent Calls', () => {
    it('maintains strict isolation between Call A and Call B', async () => {
      const stateCallA = createState('call_session_AAA', {}, fixedClock);
      const stateCallB = createState('call_session_BBB', {}, fixedClock);

      const lookupMock = vi.fn().mockImplementation((id: string) => {
        if (id === '1111') {
          return Promise.resolve({
            outcome: 'found',
            order: makeOrder({ id: '1111' }),
            customer: makeCustomer({ id: 'cust_A', name: 'Alice' }),
          });
        }
        return Promise.resolve({
          outcome: 'found',
          order: makeOrder({ id: '2222' }),
          customer: makeCustomer({ id: 'cust_B', name: 'Bob' }),
        });
      });

      const callModelMock = vi.fn().mockResolvedValue({
        spoken: 'Acknowledged.',
        plain: 'Acknowledged.',
      });

      // Execute turn for Call A
      const resA = await runTurn(
        {
          state: stateCallA,
          utterance: 'My order number is 1111',
          asrConfidence: 0.99,
          history: [],
        },
        {
          policy,
          lookupOrder: lookupMock,
          callModel: callModelMock,
          clock: fixedClock,
        },
      );

      // Execute turn for Call B
      const resB = await runTurn(
        {
          state: stateCallB,
          utterance: 'Check status for order 2222 please',
          asrConfidence: 0.99,
          history: [],
        },
        {
          policy,
          lookupOrder: lookupMock,
          callModel: callModelMock,
          clock: fixedClock,
        },
      );

      // Assert Session A only contains Call A data
      expect(resA.state.sessionId).toBe('call_session_AAA');
      expect(resA.state.verification.orderId).toBe('1111');

      // Assert Session B only contains Call B data
      expect(resB.state.sessionId).toBe('call_session_BBB');
      expect(resB.state.verification.orderId).toBe('2222');

      // Distinct events
      expect(resA.events.every((e) => e.sessionId === 'call_session_AAA')).toBe(true);
      expect(resB.events.every((e) => e.sessionId === 'call_session_BBB')).toBe(true);
    });
  });

  describe('Indian English & Currency Speech Normalisation', () => {
    it('formats Indian rupees and order reference numbers appropriately', () => {
      const text = 'Your total amount is ₹1499 for order 9876';
      const speech = normaliseForSpeech(text, 'en');
      expect(speech).toContain('1,499 rupees');
      expect(speech).toContain('nine, eight, seven, six');
    });
  });
});
