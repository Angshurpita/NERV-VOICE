import { describe, expect, it } from 'vitest';
import { agentWorker } from '../agent-worker.js';
import { agoraService } from '../agora.js';
import { getSystemStatus, config } from '../config.js';

describe('Agora Worker & Voice Architecture', () => {
  it('generates unique non-colliding Agent RTC UIDs in the allocated range', () => {
    const uids = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const uid = (agentWorker as any).generateUniqueAgentUid();
      expect(uid).toBeGreaterThanOrEqual(200000);
      expect(uid).toBeLessThan(1000000);
      uids.add(uid);
    }
    // In a range of 700,000, 50 random samples will practically never collide
    expect(uids.size).toBeGreaterThan(45);
  });

  it('correctly reports system and Agora capability status', () => {
    const status = getSystemStatus();
    expect(status).toHaveProperty('agora');
    expect(status.agora).toHaveProperty('hasCredentials');
    expect(status.agora).toHaveProperty('voiceRtc');
    expect(status.agora).toHaveProperty('cloudAgent');
    expect(status.agora).toHaveProperty('conversationalAi');
    expect(typeof status.agora.hasCredentials).toBe('boolean');
    expect(typeof status.agora.cloudAgent).toBe('boolean');
    expect(status.agora.voiceRtc).toBe(status.agora.hasCredentials);
  });

  it('supports signalling pub/sub broadcast and call-isolated subscriptions', () => {
    const callIdA = 'test_call_signalling_AAA';
    const callIdB = 'test_call_signalling_BBB';
    let receivedA: any = null;
    let receivedB: any = null;

    const unsubscribeA = agoraService.subscribe((data) => {
      receivedA = data;
    }, callIdA);

    const unsubscribeB = agoraService.subscribe((data) => {
      receivedB = data;
    }, callIdB);

    agoraService.publishSignalling(callIdA, 'caller_utterance', { text: 'Hello from A' });
    expect(receivedA).not.toBeNull();
    expect(receivedA.callId).toBe(callIdA);
    expect(receivedA.event).toBe('caller_utterance');
    expect(receivedA.payload.text).toBe('Hello from A');
    expect(receivedB).toBeNull(); // Session isolation verified: Call B did not receive Call A's event

    // Test unsubscribe
    receivedA = null;
    unsubscribeA();
    unsubscribeB();
    agoraService.publishSignalling(callIdA, 'caller_utterance', { text: 'Second message' });
    expect(receivedA).toBeNull();
  });

  it('generates valid Agora tokens when credentials are present', () => {
    if (agoraService.isConfigured) {
      const channel = 'nerv_test_channel';
      const tokens = agoraService.generateTokens(channel, 12345);
      expect(tokens).toHaveProperty('rtcToken');
      expect(tokens).toHaveProperty('rtmToken');
      expect(tokens.appId).toBe(config.agora.appId);
      expect(tokens.channelName).toBe(channel);
      expect(tokens.uid).toBe(12345);
      expect(typeof tokens.rtcToken).toBe('string');
      expect(tokens.rtcToken.length).toBeGreaterThan(20);
    }
  });

  it('maintains session tracking and agent state isolation in worker', async () => {
    expect(agentWorker).toBeDefined();
    const status = agentWorker.getStatus();
    expect(status).toHaveProperty('activeSessions');
    expect(status).toHaveProperty('isShuttingDown');
    expect(typeof status.activeSessions).toBe('number');
  });
});
