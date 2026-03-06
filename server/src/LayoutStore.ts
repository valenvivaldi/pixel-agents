import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const MAX_BACKUPS = 5;

export class LayoutStore {
  private json = '{}';
  private etag = '';
  private readonly layoutFile: string;

  constructor(private readonly dataDir: string) {
    this.layoutFile = path.join(dataDir, 'layout.json');
  }

  getJson(): string { return this.json; }
  getEtag(): string { return this.etag; }

  load(): void {
    try {
      if (fs.existsSync(this.layoutFile)) {
        this.json = fs.readFileSync(this.layoutFile, 'utf-8');
        this.etag = this.computeEtag(this.json);
      }
    } catch { /* ignore load errors */ }
  }

  update(json: string): string {
    const parsed = JSON.parse(json);
    this.validateLayout(parsed);
    this.rotateBackups();
    this.json = json;
    this.etag = this.computeEtag(json);
    this.save();
    return this.etag;
  }

  private validateLayout(layout: Record<string, unknown>): void {
    if (layout.version !== 1) {
      throw new Error('Invalid layout: missing or wrong version');
    }
    const cols = layout.cols as number;
    const rows = layout.rows as number;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
      throw new Error(`Invalid layout: bad dimensions cols=${cols} rows=${rows}`);
    }
    if (!Array.isArray(layout.tiles) || layout.tiles.length !== cols * rows) {
      throw new Error(`Invalid layout: tiles length ${Array.isArray(layout.tiles) ? layout.tiles.length : 'missing'} != ${cols * rows}`);
    }
    if (!Array.isArray(layout.furniture)) {
      throw new Error('Invalid layout: missing furniture array');
    }
  }

  private rotateBackups(): void {
    try {
      if (!fs.existsSync(this.layoutFile)) return;
      // Rotate: .5 → delete, .4 → .5, ... .1 → .2, current → .1
      for (let i = MAX_BACKUPS; i > 1; i--) {
        const from = `${this.layoutFile}.backup.${i - 1}`;
        const to = `${this.layoutFile}.backup.${i}`;
        if (fs.existsSync(from)) {
          fs.renameSync(from, to);
        }
      }
      fs.copyFileSync(this.layoutFile, `${this.layoutFile}.backup.1`);
    } catch { /* best-effort backups */ }
  }

  private save(): void {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      const tmp = this.layoutFile + '.tmp';
      fs.writeFileSync(tmp, this.json, 'utf-8');
      fs.renameSync(tmp, this.layoutFile);
    } catch { /* ignore save errors */ }
  }

  private computeEtag(json: string): string {
    return crypto.createHash('md5').update(json).digest('hex');
  }
}
