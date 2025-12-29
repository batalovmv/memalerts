import { describe, expect, it } from 'vitest';

import { getFocusableElements } from './focus';

function makeVisible(el: HTMLElement) {
  // jsdom returns empty rects by default, but our implementation treats that as "not visible".
  // Override per element to emulate a rendered layout box.
  (el as any).getClientRects = () => [{ x: 0, y: 0, width: 10, height: 10 }];
}

describe('getFocusableElements', () => {
  it('filters out aria-hidden and disabled, keeps visible focusables', () => {
    document.body.innerHTML = `
      <div id="root">
        <a id="a1" href="/x">link</a>
        <button id="b1">ok</button>
        <button id="b2" disabled>disabled</button>
        <button id="b3" aria-hidden="true">hidden</button>
        <input id="i1" />
        <input id="i2" type="hidden" />
      </div>
    `;

    const root = document.getElementById('root') as HTMLElement;
    const a1 = document.getElementById('a1') as HTMLElement;
    const b1 = document.getElementById('b1') as HTMLElement;
    const b2 = document.getElementById('b2') as HTMLElement;
    const b3 = document.getElementById('b3') as HTMLElement;
    const i1 = document.getElementById('i1') as HTMLElement;
    const i2 = document.getElementById('i2') as HTMLElement;

    makeVisible(a1);
    makeVisible(b1);
    makeVisible(b2);
    makeVisible(b3);
    makeVisible(i1);
    makeVisible(i2);

    const res = getFocusableElements(root);
    const ids = res.map((x) => x.id);

    expect(ids).toEqual(['a1', 'b1', 'i1']);
  });

  it('filters out elements with display:none', () => {
    document.body.innerHTML = `
      <div id="root">
        <button id="b1">ok</button>
        <button id="b2" style="display:none">no</button>
      </div>
    `;

    const root = document.getElementById('root') as HTMLElement;
    const b1 = document.getElementById('b1') as HTMLElement;
    const b2 = document.getElementById('b2') as HTMLElement;

    makeVisible(b1);
    makeVisible(b2);

    const res = getFocusableElements(root);
    expect(res.map((x) => x.id)).toEqual(['b1']);
  });
});








