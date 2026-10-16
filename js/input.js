// Picking tiles up and putting them down, the same way for mouse, touch and
// pen. A press that moves becomes a drag: a copy of the tile follows the
// pointer, and the square or the gap in the rack where it would land lights
// up. A press that does not move is a tap, and arrives as an ordinary click.
// What each gesture means is up to the page, through the handlers it passes.
//
// handlers.canDrag(from, id)      may this tile be picked up? from: 'rack' or 'board'
// handlers.canDrop(target, press) may it land there? target: { kind: 'cell', index }
//                                 or { kind: 'rack', position }
// handlers.drop(press, target)    it was let go over a target (null: nowhere useful)
// handlers.tapRack(id), handlers.tapCell(index, pointerType)
//
// `frame` is the board's frame, which scrolls when the board is zoomed in:
// a tile dragged near its edge scrolls it along.

const DRAG_START = 6; // pixels a pointer travels before a press counts as a drag
const EDGE = 30; // pixels from the frame's edge where a drag starts it scrolling
const SCROLL_STEP = 9; // pixels the frame scrolls each animation frame

export function setupInput({ board, rack, frame, handlers }) {
  let press = null; // { pointer, x, y, id, from, index, element, touch }
  let drag = null; // { ghost, target, slots, home, x, y, scrolling }
  let swallowClick = false;
  let lastPointer = 'mouse'; // whether the latest tap was a finger, a mouse or a pen

  addEventListener('pointerdown', event => {
    lastPointer = event.pointerType;
  }, true);

  function pressed(event, element, from) {
    if (press || event.button > 0) return;
    const id = Number(element.dataset.id);
    if (!handlers.canDrag(from, id)) return;
    press = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      id,
      from,
      index: from === 'board' ? Number(element.closest('.cell').dataset.index) : null,
      element,
      touch: event.pointerType === 'touch',
    };
  }

  rack.addEventListener('pointerdown', event => {
    const tile = event.target.closest('.tile[data-id]');
    if (tile) pressed(event, tile, 'rack');
  });

  board.addEventListener('pointerdown', event => {
    const tile = event.target.closest('.cell.pending .tile');
    if (tile) pressed(event, tile, 'board');
  });

  // The middles of the rack tiles, taken when a drag starts, so that the gap
  // opening up in the rack does not move the places it is measured against.
  function rackSlots() {
    return [...rack.querySelectorAll('.tile[data-id]')]
      .filter(tile => tile !== press.element)
      .map(tile => {
        const box = tile.getBoundingClientRect();
        return { tile, middle: box.left + box.width / 2 };
      });
  }

  function startDrag() {
    const ghost = press.element.cloneNode(true);
    ghost.classList.remove('selected');
    ghost.classList.add('ghost');
    ghost.removeAttribute('data-id');
    document.body.append(ghost);
    press.element.classList.add('lifted');
    // Where a tile from the rack started, counted among the other tiles.
    const home = press.from === 'rack' ? [...rack.querySelectorAll('.tile[data-id]')].indexOf(press.element) : -1;
    drag = { ghost, target: null, slots: rackSlots(), home };
  }

  function findTarget(x, y) {
    const under = document.elementFromPoint(x, y);
    const cell = under?.closest('.cell');
    if (cell && board.contains(cell)) {
      const target = { kind: 'cell', index: Number(cell.dataset.index), element: cell };
      return handlers.canDrop(target, press) ? target : null;
    }
    if (under?.closest('.rack-row')) {
      if (drag.slots.some(slot => !slot.tile.isConnected)) drag.slots = rackSlots();
      let position = drag.slots.findIndex(slot => x < slot.middle);
      if (position < 0) position = drag.slots.length;
      const target = { kind: 'rack', position, before: drag.slots[position]?.tile ?? null };
      return handlers.canDrop(target, press) ? target : null;
    }
    return null;
  }

  function clearTarget() {
    board.querySelector('.target')?.classList.remove('target');
    rack.querySelector('.gap-before')?.classList.remove('gap-before');
    rack.classList.remove('gap-end');
  }

  function setTarget(target) {
    const old = drag.target;
    if (old?.kind === target?.kind && old?.index === target?.index && old?.position === target?.position) return;
    clearTarget();
    drag.target = target;
    if (target?.kind === 'cell') target.element.classList.add('target');
    else if (target?.kind === 'rack' && target.position !== drag.home) {
      // A tile over the place it came from needs no gap opened for it.
      if (target.before) target.before.classList.add('gap-before');
      else rack.classList.add('gap-end');
    }
  }

  function moveDrag(x, y) {
    // On a touch screen the tile rides above the finger, where it can be seen.
    const y2 = press.touch ? y - drag.ghost.offsetHeight * 0.8 : y;
    drag.ghost.style.left = `${x}px`;
    drag.ghost.style.top = `${y2}px`;
    drag.x = x;
    drag.y = y2;
    setTarget(findTarget(x, y2));
    if (!drag.scrolling && edgeDirection(x, y2)) {
      drag.scrolling = true;
      requestAnimationFrame(scrollFrame);
    }
  }

  // Which way a zoomed board should scroll for a tile held at (x, y): towards
  // whichever edges it is close to, as long as it is over the board.
  function edgeDirection(x, y) {
    if (frame.scrollWidth <= frame.clientWidth) return null;
    const box = frame.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
    const dx = x < box.left + EDGE ? -1 : x > box.right - EDGE ? 1 : 0;
    const dy = y < box.top + EDGE ? -1 : y > box.bottom - EDGE ? 1 : 0;
    return dx || dy ? { dx, dy } : null;
  }

  function scrollFrame() {
    const direction = drag && edgeDirection(drag.x, drag.y);
    if (!direction) {
      if (drag) drag.scrolling = false;
      return;
    }
    frame.scrollLeft += direction.dx * SCROLL_STEP;
    frame.scrollTop += direction.dy * SCROLL_STEP;
    setTarget(findTarget(drag.x, drag.y));
    requestAnimationFrame(scrollFrame);
  }

  function endDrag() {
    if (!drag) return;
    clearTarget();
    drag.ghost.remove();
    press.element.classList.remove('lifted');
    drag = null;
  }

  addEventListener('pointermove', event => {
    if (!press || event.pointerId !== press.pointer) return;
    if (!drag) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_START) return;
      startDrag();
    }
    event.preventDefault();
    moveDrag(event.clientX, event.clientY);
  });

  addEventListener('pointerup', event => {
    if (!press || event.pointerId !== press.pointer) return;
    if (drag) {
      const { target } = drag;
      const done = press;
      endDrag();
      // The click that follows the end of a drag is not a tap.
      swallowClick = true;
      setTimeout(() => {
        swallowClick = false;
      }, 0);
      press = null;
      handlers.drop(done, target);
      return;
    }
    press = null;
  });

  addEventListener('pointercancel', event => {
    if (!press || event.pointerId !== press.pointer) return;
    endDrag();
    press = null;
  });

  addEventListener(
    'click',
    event => {
      if (!swallowClick) return;
      swallowClick = false;
      event.stopPropagation();
      event.preventDefault();
    },
    true,
  );

  rack.addEventListener('click', event => {
    const tile = event.target.closest('.tile[data-id]');
    if (tile) handlers.tapRack(Number(tile.dataset.id));
  });

  board.addEventListener('click', event => {
    const cell = event.target.closest('.cell');
    if (cell) handlers.tapCell(Number(cell.dataset.index), lastPointer);
  });

  // A long press would otherwise open the browser's own menu.
  for (const area of [board, rack]) area.addEventListener('contextmenu', event => event.preventDefault());

  return {
    // Drops whatever is being dragged, as when the screen changes under it.
    cancel() {
      endDrag();
      press = null;
    },
    get busy() {
      return Boolean(drag);
    },
  };
}
