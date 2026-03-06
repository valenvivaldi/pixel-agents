import * as fs from 'fs';
import * as path from 'path';

export interface SavedAgent {
  agentId: number;
  seatId?: string;
  palette: number;
  hueShift: number;
}

export interface SavedUser {
  userName: string;
  agents: SavedAgent[];
}

export class UserStore {
  private users = new Map<string, SavedUser>();
  private filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'users.json');
  }

  load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw) as SavedUser[];
        for (const user of data) {
          this.users.set(user.userName, user);
        }
      }
    } catch { /* ignore corrupt file */ }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = [...this.users.values()];
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch { /* ignore write errors */ }
  }

  /** Save agent appearance and seat for a user */
  saveUserAgents(userName: string, agents: SavedAgent[]): void {
    this.users.set(userName, { userName, agents });
    this.save();
  }

  /** Get saved agents for a user (returns empty array if unknown) */
  getUserAgents(userName: string): SavedAgent[] {
    return this.users.get(userName)?.agents ?? [];
  }
}
