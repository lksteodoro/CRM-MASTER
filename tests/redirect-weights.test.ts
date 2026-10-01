import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDestination,
  equalState,
  removeDestination,
  setWeight,
  splitEvenly,
  weightsTotal,
} from '../src/lib/redirectWeights.ts';

test('divide igual sempre fechando 100', () => {
  assert.deepEqual(splitEvenly(100, 3), [34, 33, 33]);
  assert.deepEqual(equalState(4).weights, [25, 25, 25, 25]);
});

test('ajustar um destino divide o resto igualmente entre os outros', () => {
  const state = setWeight(equalState(3), 0, 20);
  assert.deepEqual(state.weights, [20, 40, 40]);
  assert.deepEqual(state.pinned, [true, false, false]);
});

test('o segundo ajuste mantém o primeiro fixo', () => {
  let state = setWeight(equalState(3), 0, 20);
  state = setWeight(state, 1, 50);
  assert.deepEqual(state.weights, [20, 50, 30]);
});

test('não deixa passar de 100 somando os fixos', () => {
  let state = setWeight(equalState(3), 0, 70);
  state = setWeight(state, 1, 90);
  assert.deepEqual(state.weights, [70, 30, 0]);
  assert.equal(weightsTotal(state.weights), 100);
});

test('com todos fixos, o vizinho compensa', () => {
  let state = setWeight(equalState(2), 0, 70);
  assert.deepEqual(state.weights, [70, 30]);
  state = setWeight(state, 1, 10);
  assert.deepEqual(state.weights, [90, 10]);
  assert.equal(weightsTotal(state.weights), 100);
});

test('adicionar e remover destino mantém 100', () => {
  let state = setWeight(equalState(2), 0, 60);
  state = addDestination(state);
  assert.deepEqual(state.weights, [60, 20, 20]);
  state = removeDestination(state, 2);
  assert.equal(weightsTotal(state.weights), 100);
});
