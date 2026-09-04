import { describe, expect, it, vi } from 'vitest';

// Mock getModel so tests do not make external network calls to Gemini API
vi.mock('../model.js', () => ({
  getModel: () => ({
    available: true,
    generate: vi.fn().mockResolvedValue({
      reply: 'I found your order 4852. Could you please confirm your name?',
      wantsHuman: false,
    }),
    summarise: vi.fn().mockResolvedValue('Customer inquired about order 4852.'),
  }),
}));

import { startCall, findCallByChannel, handleTurn } from '../conversation.js';
import { agoraService } from '../agora.js';
import { getDatabase } from '@echosphere/db';
import { config } from '../config.js';

describe('API Conversation & Signalling Bridge', () => {
  it('starts a call with explicit channel, creates state, transcripts and emits signalling', async () => {
    const channel = `test_channel_${Date.now()}`;
    let callStartedSignal: any = null;

    const unsub = agoraService.subscribe((data) => {
      if (data.event === 'call_started') {
        callStartedSignal = data;
      }
    });

    const callResult = await startCall({
      channelName: channel,
      language: 'en',
      callerName: 'Jane Doe',
    });

    expect(callResult).toHaveProperty('callId');
    expect(callResult.channelName).toBe(channel);
    expect(callResult.language).toBe('en');
    expect(callResult.greeting).toBeDefined();

    // Verify lookup by channel
    const foundCall = await findCallByChannel(channel);
    expect(foundCall).not.toBeNull();
    expect(foundCall?.id).toBe(callResult.callId);
    expect(foundCall?.channelName).toBe(channel);

    // Verify transcripts in DB
    const db = await getDatabase(config.DATABASE_URL);
    const transcripts = await db.transcripts.forCall(callResult.callId);
    expect(transcripts.length).toBeGreaterThanOrEqual(1);
    expect(transcripts[0].speaker).toBe('agent');

    // Verify signalling event was broadcast
    expect(callStartedSignal).not.toBeNull();
    expect(callStartedSignal.callId).toBe(callResult.callId);
    expect(callStartedSignal.payload.channelName).toBe(channel);

    unsub();
  });

  it('processes handleTurn, appends transcripts, and emits agent_reply signalling', async () => {
    const channel = `test_turn_channel_${Date.now()}`;
    const callResult = await startCall({
      channelName: channel,
      language: 'en',
    });

    let agentReplySignal: any = null;
    let callerUtteranceSignal: any = null;

    const unsub = agoraService.subscribe((data) => {
      if (data.event === 'agent_reply') agentReplySignal = data;
      if (data.event === 'caller_utterance') callerUtteranceSignal = data;
    }, callResult.callId);

    const outcome = await handleTurn({
      callId: callResult.callId,
      text: 'Where is my order 4852?',
      asrConfidence: 0.95,
    });

    expect(outcome).not.toHaveProperty('error');
    if ('reply' in outcome) {
      expect(outcome.reply).toBeDefined();
      expect(typeof outcome.reply).toBe('string');
      expect(outcome.state).toBeDefined();
    }

    // Verify signalling was emitted for this call
    expect(callerUtteranceSignal).not.toBeNull();
    expect(callerUtteranceSignal.payload.text).toBe('Where is my order 4852?');
    expect(agentReplySignal).not.toBeNull();
    expect(agentReplySignal.payload.reply).toBeDefined();

    unsub();
  });
});
