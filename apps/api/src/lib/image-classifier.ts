/**
 * Prohibited-item image classifier (Module 6, section 10), behind an interface so a real
 * model can be plugged in once one is chosen and tested on a labeled launch set (open
 * question in docs/decisions.md).
 */
export interface ImageVerdict {
  flagged: boolean;
  category?: string;
  score?: number;
}

export interface ImageClassifier {
  readonly key: string;
  classify(image: Buffer): Promise<ImageVerdict>;
}

/**
 * Mock classifier: flags only images carrying the test marker `SW-TEST-PROHIBITED` in their
 * bytes (used by tests and demos). It recognises nothing else.
 */
export class MockImageClassifier implements ImageClassifier {
  readonly key = 'mock';
  async classify(image: Buffer): Promise<ImageVerdict> {
    return image.includes('SW-TEST-PROHIBITED') ? { flagged: true, category: 'weapon', score: 1 } : { flagged: false };
  }
}

export function imageClassifier(_kind: 'mock'): ImageClassifier {
  return new MockImageClassifier();
}
