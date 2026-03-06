import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseChatLine, findAgentBySession, ChatWatcher } from '../chatWatcher.js';

describe('parseChatLine', () => {
	it('parses valid JSON with session and msg', () => {
		const result = parseChatLine('{"session":"abc-123","msg":"hello"}');
		expect(result).toEqual({ session: 'abc-123', msg: 'hello' });
	});

	it('returns null for invalid JSON', () => {
		expect(parseChatLine('not json')).toBeNull();
	});

	it('returns null when session is missing', () => {
		expect(parseChatLine('{"msg":"hello"}')).toBeNull();
	});

	it('returns null when msg is missing', () => {
		expect(parseChatLine('{"session":"abc"}')).toBeNull();
	});

	it('returns null when msg is empty string', () => {
		expect(parseChatLine('{"session":"abc","msg":""}')).toBeNull();
	});

	it('returns null when session is not a string', () => {
		expect(parseChatLine('{"session":123,"msg":"hello"}')).toBeNull();
	});

	it('returns null when msg is not a string', () => {
		expect(parseChatLine('{"session":"abc","msg":42}')).toBeNull();
	});
});

describe('findAgentBySession', () => {
	it('finds agent by session UUID in jsonlFile path', () => {
		const agents = [
			{ id: 1, jsonlFile: '/home/.claude/projects/proj-hash/aaa-111.jsonl' },
			{ id: 2, jsonlFile: '/home/.claude/projects/proj-hash/bbb-222.jsonl' },
		];
		expect(findAgentBySession(agents, 'bbb-222')).toBe(2);
	});

	it('returns null when no match', () => {
		const agents = [
			{ id: 1, jsonlFile: '/home/.claude/projects/proj-hash/aaa-111.jsonl' },
		];
		expect(findAgentBySession(agents, 'zzz-999')).toBeNull();
	});

	it('works with empty iterable', () => {
		expect(findAgentBySession([], 'abc')).toBeNull();
	});
});

describe('ChatWatcher', () => {
	let tmpDir: string;
	let chatFile: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatwatch-test-'));
		chatFile = path.join(tmpDir, 'chat.jsonl');
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it('truncates file on start', () => {
		// Pre-populate file with data
		fs.writeFileSync(chatFile, '{"session":"old","msg":"stale"}\n', 'utf-8');
		const lines: Array<{ session: string; msg: string }> = [];
		const watcher = new ChatWatcher(chatFile, (line) => lines.push(line));
		watcher.start();

		// File should be empty after start
		const contents = fs.readFileSync(chatFile, 'utf-8');
		expect(contents).toBe('');

		watcher.dispose();
	});

	it('reads new lines appended after start', () => {
		const lines: Array<{ session: string; msg: string }> = [];
		const watcher = new ChatWatcher(chatFile, (line) => lines.push(line));
		watcher.start();

		fs.appendFileSync(chatFile, '{"session":"s1","msg":"hi"}\n', 'utf-8');
		watcher.readNewLines();

		expect(lines).toEqual([{ session: 's1', msg: 'hi' }]);
		watcher.dispose();
	});

	it('handles multiple lines at once', () => {
		const lines: Array<{ session: string; msg: string }> = [];
		const watcher = new ChatWatcher(chatFile, (line) => lines.push(line));
		watcher.start();

		fs.appendFileSync(chatFile, '{"session":"s1","msg":"a"}\n{"session":"s2","msg":"b"}\n', 'utf-8');
		watcher.readNewLines();

		expect(lines).toHaveLength(2);
		expect(lines[0]).toEqual({ session: 's1', msg: 'a' });
		expect(lines[1]).toEqual({ session: 's2', msg: 'b' });
		watcher.dispose();
	});

	it('skips invalid lines', () => {
		const lines: Array<{ session: string; msg: string }> = [];
		const watcher = new ChatWatcher(chatFile, (line) => lines.push(line));
		watcher.start();

		fs.appendFileSync(chatFile, 'not json\n{"session":"s1","msg":"ok"}\n{"bad":true}\n', 'utf-8');
		watcher.readNewLines();

		expect(lines).toEqual([{ session: 's1', msg: 'ok' }]);
		watcher.dispose();
	});

	it('buffers partial lines', () => {
		const lines: Array<{ session: string; msg: string }> = [];
		const watcher = new ChatWatcher(chatFile, (line) => lines.push(line));
		watcher.start();

		// Write a partial line (no trailing newline)
		fs.appendFileSync(chatFile, '{"session":"s1","msg":', 'utf-8');
		watcher.readNewLines();
		expect(lines).toHaveLength(0);

		// Complete the line
		fs.appendFileSync(chatFile, '"hello"}\n', 'utf-8');
		watcher.readNewLines();
		expect(lines).toEqual([{ session: 's1', msg: 'hello' }]);
		watcher.dispose();
	});

	it('does not read after dispose', () => {
		const lines: Array<{ session: string; msg: string }> = [];
		const watcher = new ChatWatcher(chatFile, (line) => lines.push(line));
		watcher.start();
		watcher.dispose();

		fs.appendFileSync(chatFile, '{"session":"s1","msg":"ghost"}\n', 'utf-8');
		watcher.readNewLines();

		expect(lines).toHaveLength(0);
	});

	it('creates directory if it does not exist', () => {
		const nestedDir = path.join(tmpDir, 'nested', 'dir');
		const nestedFile = path.join(nestedDir, 'chat.jsonl');
		const watcher = new ChatWatcher(nestedFile, () => {});
		watcher.start();

		expect(fs.existsSync(nestedDir)).toBe(true);
		watcher.dispose();
	});
});
