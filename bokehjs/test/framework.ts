import {LayoutDOM, LayoutDOMView} from "@bokehjs/models/layouts/layout_dom"
import {show} from "@bokehjs/api/plotting"
import {div} from "@bokehjs/core/dom"
import {isString} from "@bokehjs/core/util/types"

export type Func = () => void
export type AsyncFunc = () => Promise<void>

export type Decl = {
  fn: Func | AsyncFunc
  description?: string
}

export type Test = Decl & {
  skip: boolean
  view?: LayoutDOMView
  el?: HTMLElement
}

export type Suite = {
  description: string
  suites: Suite[]
  tests: Test[]
  before_each: Decl[]
  after_each: Decl[]
}

export const top_level: Suite = {description: "top-level", suites: [], tests: [], before_each: [], after_each: []}
const stack: Suite[] = [top_level]

export function describe(description: string, fn: Func/* | AsyncFunc*/): void {
  const suite = {description, suites: [], tests: [], before_each: [], after_each: []}
  stack[0].suites.push(suite)
  stack.unshift(suite)
  try {
    fn()
  } finally {
    stack.shift()
  }
}

type _It = {(description: string, fn: AsyncFunc): void} & {skip: Fn, with_server: Fn}

export function skip(description: string, fn: Func | AsyncFunc): void {
  stack[0].tests.push({description, fn, skip: true})
}

export const it: _It = ((description: string, fn: Func | AsyncFunc): void => {
  stack[0].tests.push({description, fn, skip: false})
}) as _It
it.skip = skip as any
it.with_server = skip as any

export function before_each(fn: Func | AsyncFunc): void {
  stack[0].before_each.push({fn})
}

export function after_each(fn: Func | AsyncFunc): void {
  stack[0].after_each.push({fn})
}

const _globalThis: any = globalThis

_globalThis.describe = describe
_globalThis.it = it
_globalThis.before_each = before_each
_globalThis.after_each = after_each

export async function run_tests(grep?: string | RegExp): Promise<void> {

  async function _run_suite(suite: Suite, seq: Suite[]) {
    for (const sub_suite of suite.suites) {
      await _run_suite(sub_suite, seq.concat(sub_suite))
    }

    for (const test of suite.tests) {
      const {description, skip} = test

      if (skip)
        continue

      if (grep != null) {
        const descriptions = seq.map((s) => s.description).concat(description ?? "")

        const macher: (d: string) => boolean =
          isString(grep) ? (d) => d.includes(grep) : (d) => d.search(grep) != -1
        if (!descriptions.some(macher))
          continue
      }

      await _run_test(seq, test)
    }
  }

  await _run_suite(top_level, [top_level])
}

let current_test: Test | null = null

export async function run_test(si: number[], ti: number): Promise<{}> {
  let current = top_level
  const suites = [current]
  for (const i of si) {
    current = current.suites[i]
    suites.push(current)
  }
  const test = current.tests[ti]
  return await _run_test(suites, test)
}

async function _run_test(suites: Suite[], test: Test): Promise<{}> {
  const {fn} = test
  const start = Date.now()
  let error: {str: string, stack?: string} | null = null
  function _handle(err: unknown): void {
    if (err instanceof Error) {
      error = {str: err.toString(), stack: err.stack}
    } else {
      error = {str: `${err}`}
    }
  }

  for (const suite of suites) {
    for (const {fn} of suite.before_each)
      await fn()
  }
  current_test = test
  try {
    await fn()
  } catch (err) {
    //throw err
    _handle(err)
  } finally {
    current_test = null
    for (const suite of suites) {
      for (const {fn} of suite.after_each)
        await fn()
    }
  }
  const end = Date.now()
  const time = end - start
  const result = (() => {
    if (error == null && test.view != null) {
      try {
        const {x, y, width, height} = test.view.el.getBoundingClientRect()
        const bbox = {x, y, width, height}
        const state = test.view.serializable_state()
        return {error, time, state, bbox}
      } catch (err) {
        //throw err
        _handle(err)
      }
    }
    return {error, time}
  })()
  return JSON.stringify(result)
}

export async function display(obj: LayoutDOM, viewport: [number, number] = [1000, 1000]): Promise<LayoutDOMView> {
  const [width, height] = viewport
  const el = div({style: {width: `${width}px`, height: `${height}px`, overflow: "hidden"}})
  document.body.appendChild(el)
  const view = await show(obj, el)
  current_test!.view = view
  current_test!.el = el
  return view
}
