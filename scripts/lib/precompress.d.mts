// The types of precompress.mjs (N18 P2 fix round 1, M1: the helper is plain JavaScript so that `pnpm build` needs no type stripping).

export declare const PRECOMPRESSED: readonly string[];
export declare const MIN_BYTES: number;
export type PrecompressedFile = { file: string; bytes: number; gzip: number | null; brotli: number | null };
export declare function precompressDir(dir: string): PrecompressedFile[];
