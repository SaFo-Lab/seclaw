/**
 * Voice transcription provider
 */

import * as fs from "fs";
import * as path from "path";
import FormData from "form-data";
import axios from "axios";
import { logger } from "../utils/logger";

export class GroqTranscriptionProvider {
  private apiKey: string | null;
  private apiUrl = "https://api.groq.com/openai/v1/audio/transcriptions";

  constructor(apiKey?: string | null) {
    this.apiKey = apiKey ?? process.env.GROQ_API_KEY ?? null;
  }

  async transcribe(filePath: string): Promise<string> {
    if (!this.apiKey) {
      logger.warn("Groq API key not configured for transcription");
      return "";
    }

    if (!fs.existsSync(filePath)) {
      logger.error({ filePath }, "Audio file not found");
      return "";
    }

    try {
      const form = new FormData();
      form.append("file", fs.createReadStream(filePath), path.basename(filePath));
      form.append("model", "whisper-large-v3");

      const response = await axios.post(this.apiUrl, form, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...form.getHeaders(),
        },
        timeout: 60000,
      });

      return response.data?.text ?? "";
    } catch (e) {
      logger.error({ err: e }, "Groq transcription error");
      return "";
    }
  }
}
