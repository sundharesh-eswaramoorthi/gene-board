import { expect, type Locator, type Page } from '@playwright/test'

export type DropPosition = 'center' | 'top' | 'bottom'

export interface DragOptions {
  /** Point on the target: its centre, or just inside its top / bottom edge. */
  position?: DropPosition
  /**
   * Waited for while the pointer rests on the target, before releasing — e.g. "the card's
   * placeholder is now in the target column". Keeps a slow render from racing the drop.
   */
  beforeDrop?: () => Promise<unknown>
}

/**
 * Drags `source` onto `target` with real mouse movement, the way dnd-kit's MouseSensor needs it:
 * press, move a few pixels to pass the 5px activation distance (and wait until dnd-kit marks the
 * item as being dragged), glide to the target in small steps, let collision detection and the
 * sortable placeholder settle, then release.
 */
export async function dragTo(page: Page, source: Locator, target: Locator, options: DragOptions | DropPosition = {}) {
  const { position = 'center', beforeDrop } = typeof options === 'string' ? { position: options } : options
  await source.scrollIntoViewIfNeeded()
  const from = await source.boundingBox()
  if (!from) throw new Error('drag source is not visible')
  const startX = from.x + from.width / 2
  const startY = from.y + from.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 6, startY + 6, { steps: 3 })
  await page.mouse.move(startX + 12, startY + 12, { steps: 3 })
  // dnd-kit sets aria-pressed on the active draggable once the drag has started.
  const dragging = page.locator('[aria-pressed="true"][aria-roledescription]')
  try {
    await expect(dragging).toHaveCount(1, { timeout: 5_000 })
  } catch (error) {
    // Say what was under the pointer, to tell a test problem from an app problem.
    const under = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y) as HTMLElement | null
        const owner = el?.closest('[data-testid]')
        return {
          element: el ? `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)}` : null,
          testId: owner?.getAttribute('data-testid') ?? null,
          roleDescription: el?.closest('[aria-roledescription]')?.getAttribute('aria-roledescription') ?? null,
        }
      },
      [startX, startY],
    )
    await page.mouse.up()
    throw new Error(`the drag did not start (pressed at ${startX},${startY}: ${JSON.stringify(under)})`, { cause: error })
  }

  // Measure the target only now: picking the source up can shift the layout.
  const to = await target.boundingBox()
  if (!to) throw new Error('drop target is not visible')
  const x = to.x + to.width / 2
  const inset = Math.min(6, to.height / 4)
  const y = position === 'top' ? to.y + inset : position === 'bottom' ? to.y + to.height - inset : to.y + to.height / 2
  await page.mouse.move(x, y, { steps: 20 })
  await page.waitForTimeout(150)
  await page.mouse.move(x, y + (position === 'top' ? -1 : 1), { steps: 2 })
  await page.waitForTimeout(150)
  if (beforeDrop) await beforeDrop()
  await page.mouse.up()
  // The drag is over once nothing is marked as being dragged; dnd-kit then ignores clicks briefly.
  await expect(dragging).toHaveCount(0)
  await page.waitForTimeout(150)
}

/** Keys of the elements matching `selector` inside `scope`, in DOM order (from data-testid). */
export async function testIdKeys(scope: Locator, prefix: string): Promise<string[]> {
  const ids = await scope.locator(`[data-testid^="${prefix}"]`).evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''))
  return ids.map((id) => id.slice(prefix.length))
}

/** Picks an option in the open combobox/listbox popover (typing into its search box first when it has one). */
export async function pickOption(page: Page, name: string | RegExp, search?: string) {
  const listbox = page.getByRole('listbox').last()
  await expect(listbox).toBeVisible()
  if (search !== undefined) {
    await page.getByRole('combobox').last().fill(search)
  }
  await listbox.getByRole('option', { name }).first().click()
}

/**
 * The control a `<label for>` with text `label` points at, inside `scope`. Pickers carry their
 * own aria-label (the current value), so getByLabel can't find them by the field label.
 */
export function fieldControl(scope: Locator, label: string): Locator {
  if (label.includes('"')) throw new Error('label must not contain double quotes')
  return scope.locator(`xpath=.//*[@id and @id = //label[starts-with(normalize-space(.), "${label}")]/@for]`)
}

/** Today's date plus `days`, as YYYY-MM-DD (UTC). */
export function isoDate(days = 0): string {
  const d = new Date(Date.now() + days * 86_400_000)
  return d.toISOString().slice(0, 10)
}
