export interface LlmPort {
  generate(prompt: string): Promise<string>;
}

export const LLM_PORT = Symbol('LlmPort');
