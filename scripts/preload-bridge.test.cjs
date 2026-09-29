'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')
const path = require('node:path')

const SERVICES = path.resolve(__dirname, '../public/preload/services.js')

function loadServicesWithGoogleRequire(shouldFail) {
  delete require.cache[SERVICES]
  const origLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'google-translate-api-x') {
      if (shouldFail) throw new Error('simulated missing google-translate-api-x')
      return origLoad.apply(this, arguments)
    }
    return origLoad.apply(this, arguments)
  }
  global.window = {}
  try {
    require(SERVICES)
    return global.window.services
  } finally {
    Module._load = origLoad
    delete require.cache[SERVICES]
  }
}

const METHODS = [
  'googleTranslate',
  'deeplTranslate',
  'deeplxTranslate',
  'requestThirdpartyAI',
  'fetchThirdpartyModels',
  'lookupWord',
]

describe('preload window.services 初始化', () => {
  it('google-translate-api-x 缺失时仍完整挂上桥接方法', () => {
    const services = loadServicesWithGoogleRequire(true)
    assert.ok(services, 'window.services 应存在')
    for (const name of METHODS) {
      assert.equal(typeof services[name], 'function', name + ' 应为函数')
    }
  })

  it('依赖可用时同样挂上全部方法', () => {
    const services = loadServicesWithGoogleRequire(false)
    assert.ok(services, 'window.services 应存在')
    for (const name of METHODS) {
      assert.equal(typeof services[name], 'function', name + ' 应为函数')
    }
  })
})
