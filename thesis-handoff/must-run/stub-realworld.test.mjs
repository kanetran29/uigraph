/**
 * Checks the stub's answers for the calls realworld's signed-in screens make, including that /user
 * refuses a request without the stub's token (so the app's guard is exercised, not bypassed).
 * Run: node --test stub-realworld.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { answer } from './stub-realworld.mjs'

test('login returns a user with a token', () => {
  const [status, body] = answer('POST', '/api/users/login', false)
  assert.equal(status, 200)
  assert.ok(body.user.token)
})

test('/user needs the token', () => {
  assert.equal(answer('GET', '/api/user', false)[0], 401)
  assert.equal(answer('GET', '/api/user', true)[1].user.username, 'mustrun')
})

test('the editable article is written by the signed-in user', () => {
  const [, body] = answer('GET', '/api/articles/introduction-to-machine-learning-for-developers', true)
  assert.equal(body.article.author.username, answer('GET', '/api/user', true)[1].user.username)
})

test('unknown paths are not served', () => {
  assert.equal(answer('GET', '/api/nothing', true), null)
})
