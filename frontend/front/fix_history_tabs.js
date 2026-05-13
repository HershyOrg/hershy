const fs = require('fs');

const path = 'lib/historyStore.ts';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes('private openTabs')) {
    content = content.replace(
        'private activeId: string | null = null;',
        'private activeId: string | null = null;\n  private openTabs: string[] = [];'
    );

    const methodsToAdd = `
  getOpenTabs(): string[] {
    return cloneValue(this.openTabs);
  }

  openTab(id: string) {
    if (!this.openTabs.includes(id)) {
      this.openTabs.push(id);
    }
    this.setActiveId(id);
  }

  closeTab(id: string) {
    this.openTabs = this.openTabs.filter(tabId => tabId !== id);
    if (this.activeId === id) {
      if (this.openTabs.length > 0) {
        this.setActiveId(this.openTabs[this.openTabs.length - 1]);
      } else {
        this.activeId = null; // No tabs open
        this.notify();
      }
    } else {
      this.notify();
    }
  }
`;
    // Find the right place to inject them (after notify)
    content = content.replace(
        'private notify() {\n    this.listeners.forEach(l => l());\n  }',
        'private notify() {\n    this.listeners.forEach(l => l());\n  }' + methodsToAdd
    );
    
    // Also modify active logic to add to tabs if missing
    content = content.replace(
        'setActiveId(id: string) {',
        'setActiveId(id: string) {\n    if (id && !this.openTabs.includes(id)) {\n      this.openTabs.push(id);\n    }'
    );
    
    // Auto-open initial tabs when creating standard snaps
    content = content.replace(
        'this.activeId = snapA_A.id;',
        'this.activeId = snapA_A.id;\n      this.openTabs = [snap1.id, snapA_A.id];'
    );
    
    fs.writeFileSync(path, content, 'utf8');
    console.log("Injected openTabs logic");
} else {
    console.log("Already has openTabs");
}
