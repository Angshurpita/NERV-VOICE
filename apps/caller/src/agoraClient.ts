import AgoraRTC, {
  type IAgoraRTCClient,
  type IMicrophoneAudioTrack,
  type IRemoteAudioTrack,
} from "agora-rtc-sdk-ng";

export interface AgoraConnection {
  channelName: string;
  uid: number;
  appId: string;
  rtcToken: string;
  rtmToken?: string;
}

export class AgoraCallManager {
  private client: IAgoraRTCClient | null = null;
  private localAudioTrack: IMicrophoneAudioTrack | null = null;
  private isJoined = false;

  onVolume?: (level: number) => void;
  onRemoteUserJoined?: (uid: string | number) => void;
  onRemoteUserLeft?: (uid: string | number) => void;
  onStreamMessage?: (data: any) => void;
  onError?: (err: Error) => void;

  async join(params: AgoraConnection): Promise<void> {
    if (this.isJoined) return;

    try {
      this.client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

      // Listen for remote audio from the Agora Conversational AI Agent
      this.client.on("user-published", async (user, mediaType) => {
        if (mediaType === "audio") {
          try {
            await this.client?.subscribe(user, mediaType);
            const remoteAudioTrack = user.audioTrack as
              IRemoteAudioTrack | undefined;
            if (remoteAudioTrack) {
              remoteAudioTrack.play();
            }
            this.onRemoteUserJoined?.(user.uid);
          } catch (subErr) {
            console.error(
              "[Agora] Error subscribing to remote agent audio:",
              subErr,
            );
          }
        }
      });

      this.client.on("user-unpublished", (user, mediaType) => {
        if (mediaType === "audio") {
          this.onRemoteUserLeft?.(user.uid);
        }
      });

      // Listen for real-time datastream events from the Agora Conversational AI Agent
      this.client.on("stream-message", (uid, data) => {
        try {
          const text = new TextDecoder().decode(data);
          const parsed = JSON.parse(text);
          this.onStreamMessage?.(parsed);
        } catch {
          // ignore non-json messages
        }
      });

      // Enable volume indicator for real-time speech visualization
      this.client.enableAudioVolumeIndicator();
      this.client.on("volume-indicator", (volumes) => {
        let maxLevel = 0;
        for (const v of volumes) {
          if (v.level > maxLevel) maxLevel = v.level;
        }
        if (this.onVolume) {
          this.onVolume(Math.round((maxLevel / 100) * 100));
        }
      });

      // Join Agora channel
      await this.client.join(
        params.appId,
        params.channelName,
        params.rtcToken,
        params.uid || null,
      );

      // Create and publish local microphone stream
      // CRITICAL REQUIREMENT: Real voice calls MUST have working microphone audio.
      // If microphone cannot be created or published, the call MUST fail immediately.
      try {
        this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack({
          AEC: true, // Acoustic Echo Cancellation
          ANS: true, // Automatic Noise Suppression
          AGC: true, // Automatic Gain Control
        });
      } catch (audioErr: any) {
        console.error("[Agora] Microphone track creation failed:", audioErr);
        await this.leave().catch(() => undefined);
        throw new Error(
          `Microphone access denied or unavailable: ${audioErr?.message || String(audioErr)}. A real microphone is required for voice calls.`,
        );
      }

      try {
        await this.client.publish([this.localAudioTrack]);
      } catch (pubErr: any) {
        console.error("[Agora] Microphone track publication failed:", pubErr);
        await this.leave().catch(() => undefined);
        throw new Error(
          `Failed to publish microphone audio to Agora RTC: ${pubErr?.message || String(pubErr)}`,
        );
      }

      // Subscribe to any remote users already in the channel
      for (const remoteUser of this.client.remoteUsers) {
        if (remoteUser.hasAudio) {
          try {
            await this.client.subscribe(remoteUser, "audio");
            const remoteTrack = remoteUser.audioTrack as
              IRemoteAudioTrack | undefined;
            remoteTrack?.play();
            this.onRemoteUserJoined?.(remoteUser.uid);
          } catch {
            // ignore
          }
        }
      }

      this.isJoined = true;
    } catch (err) {
      const formatted = err instanceof Error ? err : new Error(String(err));
      this.onError?.(formatted);
      throw formatted;
    }
  }

  setMute(muted: boolean): void {
    if (this.localAudioTrack) {
      this.localAudioTrack.setEnabled(!muted);
    }
  }

  async leave(): Promise<void> {
    if (!this.isJoined && !this.client && !this.localAudioTrack) return;

    try {
      if (this.localAudioTrack) {
        this.localAudioTrack.stop();
        this.localAudioTrack.close();
        this.localAudioTrack = null;
      }
      if (this.client) {
        await this.client.leave();
        this.client.removeAllListeners();
        this.client = null;
      }
    } finally {
      this.isJoined = false;
    }
  }

  get connected(): boolean {
    return this.isJoined;
  }
}

export const agoraCallManager = new AgoraCallManager();
