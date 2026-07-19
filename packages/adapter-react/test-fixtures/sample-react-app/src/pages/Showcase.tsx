import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

// A deliberately exhaustive control/event surface for the golden fixture: every
// native control type (text/email/password/number/date/range/color/search/file
// inputs, checkbox, radio, textarea, select, contentEditable), buttons, links, and
// custom interactive elements, wired to the full spread of DOM events (change,
// input, focus, blur, keydown/up/press, paste/copy/cut, mouse enter/leave/down/up,
// double-click, context menu, wheel, scroll, drag/drop, touch). Each control
// carries a name/placeholder/aria-label so the extractor names it.
export default function Showcase() {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [agree, setAgree] = useState(false)

  return (
    <form name="profileForm" onSubmit={() => navigate('/')}>
      <h1>Showcase</h1>

      <input name="username" type="text" placeholder="Username" value={text} onChange={(e) => setText(e.target.value)} onFocus={() => {}} onBlur={() => {}} onKeyDown={() => {}} onPaste={() => {}} />
      <input name="email" type="email" placeholder="Email" required onInput={() => {}} />
      <input name="password" type="password" placeholder="Password" onChange={() => {}} onCopy={() => {}} onCut={() => {}} />
      <input name="age" type="number" min="0" max="120" onChange={() => {}} />
      <input name="birthday" type="date" onChange={() => {}} />
      <input name="volume" type="range" min="0" max="10" onChange={() => {}} onInput={() => {}} />
      <input name="favoriteColor" type="color" onChange={() => {}} />
      <input name="query" type="search" placeholder="Search" onKeyUp={() => {}} />
      <input name="avatar" type="file" onChange={() => {}} />

      <input name="subscribe" type="checkbox" checked={agree} onChange={() => setAgree(!agree)} />
      <input name="plan" type="radio" value="free" onChange={() => {}} />
      <input name="plan" type="radio" value="pro" onChange={() => {}} />

      <textarea name="bio" placeholder="Tell us about yourself" onChange={() => {}} onKeyDown={() => {}} />

      <select name="country" onChange={() => {}}>
        <option value="fi">Finland</option>
        <option value="se">Sweden</option>
      </select>

      <div contentEditable aria-label="Rich note" onInput={() => {}} onPaste={() => {}} />

      <button type="submit">Save profile</button>
      <button type="button" onClick={() => navigate('/')}>
        Cancel
      </button>

      <ul role="list" onScroll={() => {}} onWheel={() => {}}>
        <li onMouseEnter={() => {}} onMouseLeave={() => {}} onDoubleClick={() => {}} onContextMenu={() => {}}>
          Hover / right-click me
        </li>
        <li draggable onDragStart={() => {}} onDragEnd={() => {}}>
          Drag me
        </li>
        <li onDragOver={(e) => e.preventDefault()} onDrop={() => {}}>
          Drop zone
        </li>
      </ul>

      <a href="/help" onClick={() => {}}>
        Help
      </a>
      <span role="button" tabIndex={0} aria-label="Custom action" onKeyPress={() => {}} onClick={() => {}}>
        Custom action
      </span>
    </form>
  )
}
