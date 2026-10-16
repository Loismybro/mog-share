import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectFileCategory,
  saveToPersonalSpace,
  getPersonalSpaceItems,
  deleteFromPersonalSpace,
  clearPersonalSpace,
  type PersonalSpaceItem,
} from '../../apps/web/src/utils/personalSpace.js';

describe('Personal Space Vault & File Categorization', () => {
  beforeEach(async () => {
    await clearPersonalSpace();
  });

  describe('detectFileCategory', () => {
    it('correctly categorizes images from extension and mime type', () => {
      expect(detectFileCategory('photo.jpg', 'image/jpeg')).toBe('images');
      expect(detectFileCategory('photo.PNG', '')).toBe('images');
      expect(detectFileCategory('banner.webp', 'image/webp')).toBe('images');
      expect(detectFileCategory('drawing.svg', '')).toBe('images');
      expect(detectFileCategory('icon.ico', '')).toBe('images');
      expect(detectFileCategory('camera.heic', '')).toBe('images');
    });

    it('correctly categorizes music and audio files', () => {
      expect(detectFileCategory('track.mp3', 'audio/mpeg')).toBe('audio');
      expect(detectFileCategory('voice.wav', 'audio/wav')).toBe('audio');
      expect(detectFileCategory('audio.ogg', '')).toBe('audio');
      expect(detectFileCategory('recording.m4a', 'audio/mp4')).toBe('audio');
      expect(detectFileCategory('song.flac', '')).toBe('audio');
      expect(detectFileCategory('podcast.opus', '')).toBe('audio');
    });

    it('correctly categorizes videos', () => {
      expect(detectFileCategory('movie.mp4', 'video/mp4')).toBe('videos');
      expect(detectFileCategory('clip.mkv', '')).toBe('videos');
      expect(detectFileCategory('stream.webm', 'video/webm')).toBe('videos');
      expect(detectFileCategory('recording.mov', '')).toBe('videos');
    });

    it('correctly categorizes Android APKs', () => {
      expect(detectFileCategory('whatsapp.apk', 'application/vnd.android.package-archive')).toBe('apps');
      expect(detectFileCategory('game.XAPK', '')).toBe('apps');
      expect(detectFileCategory('bundle.aab', '')).toBe('apps');
    });

    it('correctly categorizes archives', () => {
      expect(detectFileCategory('backup.zip', 'application/zip')).toBe('archives');
      expect(detectFileCategory('files.rar', '')).toBe('archives');
      expect(detectFileCategory('archive.7z', '')).toBe('archives');
      expect(detectFileCategory('dist.tar.gz', '')).toBe('archives');
    });

    it('correctly categorizes documents and code files', () => {
      expect(detectFileCategory('report.pdf', 'application/pdf')).toBe('documents');
      expect(detectFileCategory('notes.txt', 'text/plain')).toBe('documents');
      expect(detectFileCategory('data.json', 'application/json')).toBe('documents');
      expect(detectFileCategory('script.ts', '')).toBe('documents');
      expect(detectFileCategory('sheet.xlsx', '')).toBe('documents');
      expect(detectFileCategory('contract.docx', '')).toBe('documents');
    });

    it('defaults unknown binaries to other', () => {
      expect(detectFileCategory('firmware.bin', 'application/octet-stream')).toBe('other');
      expect(detectFileCategory('data.dat', '')).toBe('other');
    });
  });

  describe('Personal Space Storage CRUD', () => {
    it('saves received files and retrieves them in newest-first order', async () => {
      const dummyBlob1 = new Blob(['sample text data'], { type: 'text/plain' });
      const dummyBlob2 = new Blob(['image binary mock'], { type: 'image/png' });

      await saveToPersonalSpace({
        id: 'trans-1',
        name: 'test_doc.txt',
        size: 16,
        type: 'text/plain',
        senderName: 'Android (A1)',
        senderId: 'peer-1',
        receivedAt: 1000,
        blob: dummyBlob1,
      });

      await saveToPersonalSpace({
        id: 'trans-2',
        name: 'sunset.png',
        size: 1024,
        type: 'image/png',
        senderName: 'Pixel 8',
        senderId: 'peer-2',
        receivedAt: 2000,
        blob: dummyBlob2,
      });

      const items = await getPersonalSpaceItems();
      expect(items.length).toBe(2);
      expect(items[0].id).toBe('trans-2'); // newest first
      expect(items[0].category).toBe('images');
      expect(items[1].id).toBe('trans-1');
      expect(items[1].category).toBe('documents');
    });

    it('deletes an item from Personal Space', async () => {
      await saveToPersonalSpace({
        id: 'file-to-delete',
        name: 'temp.mp3',
        size: 2048,
        type: 'audio/mpeg',
        senderName: 'Sender',
        receivedAt: Date.now(),
      });

      let items = await getPersonalSpaceItems();
      expect(items.some((i) => i.id === 'file-to-delete')).toBe(true);

      await deleteFromPersonalSpace('file-to-delete');
      items = await getPersonalSpaceItems();
      expect(items.some((i) => i.id === 'file-to-delete')).toBe(false);
    });

    it('clears all items from Personal Space', async () => {
      await saveToPersonalSpace({
        id: 'f1',
        name: 'a.apk',
        size: 500,
        type: 'application/vnd.android.package-archive',
        senderName: 'Phone',
        receivedAt: 100,
      });
      await saveToPersonalSpace({
        id: 'f2',
        name: 'b.pdf',
        size: 800,
        type: 'application/pdf',
        senderName: 'Phone',
        receivedAt: 200,
      });

      let items = await getPersonalSpaceItems();
      expect(items.length).toBe(2);

      await clearPersonalSpace();
      items = await getPersonalSpaceItems();
      expect(items.length).toBe(0);
    });
  });
});
