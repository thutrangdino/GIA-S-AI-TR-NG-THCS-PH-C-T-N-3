
export class SpeechService {
  private recognition: any;
  private isSupported: boolean = false;

  constructor() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.isSupported = true;
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.lang = 'vi-VN'; // Set language to Vietnamese
    }
  }

  start(onResult: (text: string) => void, onError: (error: string) => void, onEnd: () => void) {
    if (!this.isSupported) {
      onError("Trình duyệt không hỗ trợ nhận diện giọng nói.");
      return;
    }

    this.recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      onResult(text);
    };

    this.recognition.onerror = (event: any) => {
      onError(event.error);
    };

    this.recognition.onend = () => {
      onEnd();
    };

    try {
      this.recognition.start();
    } catch (e) {
      console.error("Speech recognition start error:", e);
    }
  }

  stop() {
    if (this.recognition) {
      this.recognition.stop();
    }
  }

  checkSupport() {
    return this.isSupported;
  }
}

export const speechService = new SpeechService();
