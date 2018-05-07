'use strict'

import * as vscode from 'vscode'
import { join } from 'path'
const tailwindClassNames = require('tailwind-class-names')
// const tailwindClassNames = require('/Users/brad/Code/tailwind-class-names/dist')
const dlv = require('dlv')

const CONFIG_GLOB = '{tailwind,tailwind.config,.tailwindrc}.js'

export async function activate(context: vscode.ExtensionContext) {
  let tw

  try {
    tw = await getTailwind()
  } catch (err) {}

  let intellisense = new TailwindIntellisense(tw)
  context.subscriptions.push(intellisense)

  let watcher = vscode.workspace.createFileSystemWatcher(`**/${CONFIG_GLOB}`)

  watcher.onDidChange(onFileChange)
  watcher.onDidCreate(onFileChange)
  watcher.onDidDelete(onFileChange)

  async function onFileChange(event) {
    try {
      tw = await getTailwind()
    } catch (err) {
      intellisense.dispose()
      return
    }

    intellisense.reload(tw)
  }
}

async function getTailwind() {
  if (!vscode.workspace.name) return

  let files = await vscode.workspace.findFiles(
    CONFIG_GLOB,
    '**/node_modules/**',
    1
  )
  if (!files) return null

  let configPath = files[0].fsPath

  const plugin = join(
    vscode.workspace.workspaceFolders[0].uri.fsPath,
    'node_modules',
    'tailwindcss'
  )

  let tw

  try {
    tw = await tailwindClassNames(
      configPath,
      {
        tree: true,
        strings: true
      },
      plugin
    )
  } catch (err) {
    return null
  }

  return tw
}

export function deactivate() {}

function createCompletionItemProvider(
  items,
  languages: string[],
  regex: RegExp,
  triggerCharacters: string[],
  config,
  prefix = ''
): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    languages,
    {
      provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
      ): vscode.CompletionItem[] {
        const range: vscode.Range = new vscode.Range(
          new vscode.Position(Math.max(position.line - 5, 0), 0),
          position
        )
        const text: string = document.getText(range)

        let p = prefix
        const separator = config.options.separator || ':'

        const matches = text.match(regex)

        if (matches) {
          const parts = matches[matches.length - 1].split(' ')
          const str = parts[parts.length - 1]

          const pth = str
            .replace(new RegExp(`${separator}`, 'g'), '.')
            .replace(/\.$/, '')
            .replace(/^\./, '')
            .replace(/\./g, '.children.')

          if (pth !== '') {
            const itms = dlv(items, pth)
            if (itms) {
              return prefixItems(itms.children, str, prefix)
            }
          }

          return prefixItems(items, str, prefix)
        }

        return []
      }
    },
    ...triggerCharacters
  )
}

function prefixItems(items, str, prefix) {
  const addPrefix =
    typeof prefix !== 'undefined' && prefix !== '' && str === prefix

  return Object.keys(items).map(x => {
    const item = items[x].item
    if (addPrefix) {
      item.filterText = item.insertText = `${prefix}${item.label}`
    } else {
      item.filterText = item.insertText = item.label
    }
    return item
  })
}

function depthOf(obj) {
  if (typeof obj !== 'object') return 0

  let level = 1

  for (let key in obj) {
    if (!obj.hasOwnProperty(key)) continue

    if (typeof obj[key] === 'object') {
      const depth = depthOf(obj[key]) + 1
      level = Math.max(depth, level)
    }
  }

  return level
}

function createItems(classNames, separator, config, parent = '') {
  let items = {}

  Object.keys(classNames).forEach(key => {
    if (depthOf(classNames[key]) === 0) {
      const item = new vscode.CompletionItem(
        key,
        vscode.CompletionItemKind.Constant
      )
      if (key !== 'container' && key !== 'group') {
        if (parent) {
          item.detail = classNames[key].replace(
            new RegExp(`:${parent} \{(.*?)\}`),
            '$1'
          )
        } else {
          item.detail = classNames[key]
        }
      }
      items[key] = {
        item
      }
    } else {
      const item = new vscode.CompletionItem(
        `${key}${separator}`,
        vscode.CompletionItemKind.Constant
      )
      item.command = { title: '', command: 'editor.action.triggerSuggest' }
      if (key === 'hover' || key === 'focus' || key === 'active') {
        item.detail = `:${key}`
      } else if (key === 'group-hover') {
        item.detail = '.group:hover &'
      } else if (
        config.screens &&
        Object.keys(config.screens).indexOf(key) !== -1
      ) {
        item.detail = `@media (min-width: ${config.screens[key]})`
      }
      items[key] = {
        item,
        children: createItems(classNames[key], separator, config, key)
      }
    }
  })

  return items
}

class TailwindIntellisense {
  private _completionProviders: vscode.Disposable[]
  private _disposable: vscode.Disposable
  private _items

  constructor(tailwind) {
    if (tailwind) {
      this.reload(tailwind)
    }
  }

  public reload(tailwind) {
    this.dispose()

    const separator = dlv(tailwind.config, 'options.separator', ':')

    if (separator !== ':') return

    this._items = createItems(tailwind.classNames, separator, tailwind.config)

    this._completionProviders = []

    this._completionProviders.push(
      createCompletionItemProvider(
        this._items,
        ['typescriptreact', 'javascript', 'javascriptreact'],
        /\btw`([^`]*)$/,
        ['`', ' ', separator],
        tailwind.config
      )
    )

    this._completionProviders.push(
      createCompletionItemProvider(
        this._items,
        ['css', 'sass', 'scss'],
        /@apply ([^;}]*)$/,
        ['.', separator],
        tailwind.config,
        '.'
      )
    )

    this._completionProviders.push(
      createCompletionItemProvider(
        this._items,
        [
          'html',
          'jade',
          'razor',
          'php',
          'blade',
          'vue',
          'twig',
          'markdown',
          'erb',
          'handlebars',
          'ejs',
          // for jsx
          'typescriptreact',
          'javascript',
          'javascriptreact'
        ],
        /\bclass(Name)?=["']([^"']*)/, // /\bclass(Name)?=(["'])(?!.*?\2)/
        ["'", '"', ' ', separator],
        tailwind.config
      )
    )

    this._disposable = vscode.Disposable.from(...this._completionProviders)
  }

  dispose() {
    if (this._disposable) {
      this._disposable.dispose()
    }
  }
}