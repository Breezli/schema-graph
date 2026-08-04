/// <reference lib="webworker" />

import ELK from 'elkjs/lib/elk-api.js'
import ElkEngineWorker from 'elkjs/lib/elk-worker.min.js?worker'

import { layoutSchemaGraph } from './layout-engine'

const elk = new ELK({
  workerFactory: () => new ElkEngineWorker(),
})

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  void layoutSchemaGraph(event.data, elk).then((result) => self.postMessage(result))
})

export {}
