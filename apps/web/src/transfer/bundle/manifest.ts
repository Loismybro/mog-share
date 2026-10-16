export interface BundleItem {
  id: string;
  path: string; // e.g. "photos/vacation/sunset.jpg" or "document.pdf"
  size: number;
  lastModified: number;
  selected: boolean;
  status: 'queued' | 'sending' | 'receiving' | 'paused' | 'done' | 'failed' | 'cancelled';
  bytesTransferred: number;
  error?: string;
}

export class BundleManifest {
  private items = new Map<string, BundleItem>();

  public addFiles(files: Array<{ path: string; size: number; lastModified: number }>) {
    for (const f of files) {
      const id = Math.random().toString(36).slice(2, 10);
      this.items.set(id, {
        id,
        path: f.path,
        size: f.size,
        lastModified: f.lastModified,
        selected: true,
        status: 'queued',
        bytesTransferred: 0,
      });
    }
  }

  public toggleSelection(id: string, selected: boolean) {
    const item = this.items.get(id);
    if (item) item.selected = selected;
  }

  public selectAll(selected: boolean) {
    for (const item of this.items.values()) {
      item.selected = selected;
    }
  }

  public updateStatus(
    id: string,
    status: BundleItem['status'],
    bytesTransferred?: number,
    error?: string
  ) {
    const item = this.items.get(id);
    if (item) {
      item.status = status;
      if (bytesTransferred !== undefined) item.bytesTransferred = bytesTransferred;
      if (error !== undefined) item.error = error;
    }
  }

  public getSelectedItems(): BundleItem[] {
    return Array.from(this.items.values()).filter((item) => item.selected);
  }

  public getAllItems(): BundleItem[] {
    return Array.from(this.items.values());
  }

  public getTotalBytes(): { total: number; selected: number; completed: number } {
    let total = 0;
    let selected = 0;
    let completed = 0;

    for (const item of this.items.values()) {
      total += item.size;
      if (item.selected) {
        selected += item.size;
        completed += item.bytesTransferred;
      }
    }

    return { total, selected, completed };
  }
}
