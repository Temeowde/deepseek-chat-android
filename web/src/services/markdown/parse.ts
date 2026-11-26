import type { Node as MdAstNode, Nodes, Parent, RootContent, Root, Text } from 'mdast'
import { findAndReplace } from 'mdast-util-find-and-replace'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-llm-math'
import type { Source } from '../chat/view.js'

/** 正文里的 [citation:N]，已换成对应来源 */
export interface CitationNode extends MdAstNode {
  type: 'citation'
  sources: Source[]
}

declare module 'mdast' {
  interface RootContentMap {
    citation: CitationNode
  }

  interface PhrasingContentMap {
    citation: CitationNode
  }
}

const text = (value: string): Text => ({ type: 'text', value })

/**
 * 先把 LaTeX 片段抽成占位符，markdown 解析完再还原成数学节点。
 *
 * 官方内容里公式有三种写法：backslash-paren、backslash-bracket（display 块）、美元符号。
 * 交给 micromark 直接解析时，只要上下文稍复杂（列表里、紧贴文字、配对不规整），
 * backslash 和花括号就会原样漏出来、下划线还会被当成强调吃掉，看起来就是「公式没渲染」。
 * 这里改成占位符方案：解析前先把公式抠出来换成不可见占位符，解析完再替换回数学节点，
 * 与强调、链接、列表等语法彻底解耦。围栏代码块和行内代码里的内容保持原样。
 */
type MathSpan = { value: string; inline: boolean }
const PLACEHOLDER = '\uE000'

const extractMath = (input: string): { text: string; spans: MathSpan[] } => {
  const BS = String.fromCharCode(92)
  if (!input.includes(BS) && !input.includes('$')) {
    return { text: input, spans: [] }
  }
  const spans: MathSpan[] = []
  const codes: string[] = []
  const codeMarker = (index: number) => PLACEHOLDER + 'C' + index + PLACEHOLDER
  const mathMarker = (index: number) => PLACEHOLDER + 'M' + index + PLACEHOLDER
  const push = (value: string, inline: boolean) => {
    spans.push({ value: value.trim(), inline })
    return mathMarker(spans.length - 1)
  }
  // 先保护代码，避免改动其中的反斜杠或美元符号
  let text = input
    .replace(/```[\s\S]*?```/g, (match) => {
      codes.push(match)
      return codeMarker(codes.length - 1)
    })
    .replace(/`[^`\n]*`/g, (match) => {
      codes.push(match)
      return codeMarker(codes.length - 1)
    })
  // 正则里要匹配字面量反斜杠 + 方括号/圆括号：\\\[ 这种写法才不会把 [ 当成字符类
  const bracketOpen = BS + BS + BS + '['
  const bracketClose = BS + BS + BS + ']'
  const parenOpen = BS + BS + BS + '('
  const parenClose = BS + BS + BS + ')'
  text = text
    .replace(new RegExp(bracketOpen + '([\\s\\S]*?)' + bracketClose, 'g'), (_match, body: string) => push(body, false))
    .replace(new RegExp(parenOpen + '([\\s\\S]*?)' + parenClose, 'g'), (_match, body: string) => push(body, true))
    .replace(/\$\$([\s\S]*?)\$\$/g, (_match, body: string) => push(body, false))
    .replace(/\$([^$\n]+?)\$/g, (_match, body: string) => push(body, true))
  text = text.replace(/\uE000C(\d+)\uE000/g, (_match, index: string) => codes[Number(index)] ?? '')
  return { text, spans }
}

/** 把占位符还原成 inlineMath / math 节点。 */
const restoreMath = (node: Nodes, spans: MathSpan[]): void => {
  if (!('children' in node)) {
    return
  }
  const parent = node as Parent
  const next: RootContent[] = []
  for (const child of parent.children as Nodes[]) {
    if (child.type === 'text' && child.value.includes(PLACEHOLDER)) {
      const parts = child.value.split(new RegExp('(' + PLACEHOLDER + 'M\\d+' + PLACEHOLDER + ')'))
      for (const part of parts) {
        const match = new RegExp('^' + PLACEHOLDER + 'M(\\d+)' + PLACEHOLDER + '$').exec(part)
        const span = match ? spans[Number(match[1])] : undefined
        if (span) {
          next.push(
            span.inline
              ? ({ type: 'inlineMath', value: span.value } as unknown as RootContent)
              : ({ type: 'math', value: span.value } as unknown as RootContent)
          )
        } else if (part) {
          next.push({ type: 'text', value: part } as RootContent)
        }
      }
      continue
    }
    restoreMath(child, spans)
    next.push(child as RootContent)
  }
  parent.children = next
}
/**
 * 解析正文，并把渲染器不单独处理的节点提前换掉，渲染时无需再读原文：
 * - 传入 sources 时，[citation:N] 换成角标节点，找不到来源的直接去掉
 * - disableLink 时链接只保留文字
 * - 删除线保留原样的 ~ 定界符，脚注、引用式链接与定义显示原文
 */
export function toMdAst(
  input: string,
  { sources, disableLink }: { sources: Source[] | undefined; disableLink: boolean }
): Root {
  const { text: masked, spans } = extractMath(input)
  const ast = fromMarkdown(masked, {
    extensions: [
      // codeIndented 语法导致有前导空格的列表无法正常渲染
      { ...gfm(), disable: { null: ['codeIndented'] } },
      math({ singleDollarTextMath: true }),
    ],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })
  if (sources) {
    const sourcesByIndex = new Map(sources.map((source) => [source.index, source]))
    findAndReplace(
      ast,
      [
        /\[citation:\d+\](?:[ \t]*\[citation:\d+\])*/g,
        (run: string): CitationNode | '' => {
          const group = new Set<Source>()
          for (const match of run.matchAll(/\[citation:(\d+)\]/g)) {
            const source = sourcesByIndex.get(Number(match[1]))
            if (source) group.add(source)
          }
          return group.size ? { type: 'citation', sources: [...group] } : ''
        },
      ],
      { ignore: ['linkReference'] }
    )
  }
  const raw = (node: Nodes) => input.slice(node.position?.start.offset, node.position?.end.offset)
  // 先处理子节点，再按需把当前节点换成若干节点
  const simplify = (node: Nodes): Nodes[] => {
    if ('children' in node) {
      ;(node as Parent).children = node.children.flatMap(simplify) as RootContent[]
    }
    switch (node.type) {
      case 'link':
        return disableLink ? node.children : [node]
      case 'delete': {
        // 解析器保证首尾定界符等长
        const delimiter = raw(node).match(/^~+/)?.[0] ?? ''
        return [text(delimiter), ...node.children, text(delimiter)]
      }
      case 'footnoteReference':
      case 'imageReference':
      case 'linkReference':
        return [text(raw(node))]
      case 'footnoteDefinition':
      case 'definition':
        return [{ type: 'paragraph', children: [text(raw(node))] }]
      default:
        return [node]
    }
  }
  simplify(ast)
  restoreMath(ast, spans)
  return ast
}
