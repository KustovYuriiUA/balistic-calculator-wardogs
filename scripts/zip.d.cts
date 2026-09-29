export interface ZipSource {
  full: string
  name: string
}

export function listFiles(dir: string, prefix?: string): ZipSource[]

export function writeZip(output: string, entries: ZipSource[]): void
