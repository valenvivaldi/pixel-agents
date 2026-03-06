import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CHAT_FILE = path.join(os.homedir(), '.pixel-agents', 'chat.jsonl');
const POLL_INTERVAL_MS = 500;

export interface ChatLine {
	session: string;
	msg: string;
}

export function parseChatLine(line: string): ChatLine | null {
	try {
		const obj = JSON.parse(line);
		if (typeof obj.session === 'string' && typeof obj.msg === 'string' && obj.msg.length > 0) {
			return { session: obj.session, msg: obj.msg };
		}
	} catch { /* ignore bad lines */ }
	return null;
}

export function findAgentBySession(
	agents: Iterable<{ id: number; jsonlFile: string }>,
	sessionId: string,
): number | null {
	for (const agent of agents) {
		const basename = path.basename(agent.jsonlFile, '.jsonl');
		if (basename === sessionId) return agent.id;
	}
	return null;
}

export class ChatWatcher {
	private offset = 0;
	private lineBuffer = '';
	private fsWatcher: fs.FSWatcher | null = null;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private disposed = false;

	constructor(
		private readonly chatFile: string,
		private readonly onLine: (line: ChatLine) => void,
	) {}

	static defaultPath(): string {
		return CHAT_FILE;
	}

	start(): void {
		const dir = path.dirname(this.chatFile);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		// Truncate old messages on start
		try {
			fs.writeFileSync(this.chatFile, '', 'utf-8');
		} catch { /* ignore */ }
		this.offset = 0;
		this.lineBuffer = '';

		try {
			this.fsWatcher = fs.watch(this.chatFile, () => this.readNewLines());
		} catch { /* watch may fail, polling backup */ }

		this.pollTimer = setInterval(() => this.readNewLines(), POLL_INTERVAL_MS);
	}

	dispose(): void {
		this.disposed = true;
		if (this.fsWatcher) {
			this.fsWatcher.close();
			this.fsWatcher = null;
		}
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	readNewLines(): void {
		if (this.disposed) return;
		try {
			if (!fs.existsSync(this.chatFile)) return;
			const stat = fs.statSync(this.chatFile);
			if (stat.size <= this.offset) return;

			const fd = fs.openSync(this.chatFile, 'r');
			const buf = Buffer.alloc(stat.size - this.offset);
			fs.readSync(fd, buf, 0, buf.length, this.offset);
			fs.closeSync(fd);
			this.offset = stat.size;

			const text = this.lineBuffer + buf.toString('utf-8');
			const lines = text.split('\n');
			this.lineBuffer = lines.pop() || '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				const parsed = parseChatLine(trimmed);
				if (parsed) {
					this.onLine(parsed);
				}
			}
		} catch { /* ignore read errors */ }
	}
}
