Underlined portal tabs with a purple active rule — the topics switcher from the screenshots.

```jsx
<Tabs
  tabs={[{id:'temas',label:'Temas'},{id:'econ',label:'Economía'},{id:'cripto',label:'Cripto',count:12}]}
  defaultValue="temas"
  onChange={setTab}
/>
```

Controlled via `value`/`onChange` or uncontrolled via `defaultValue`. Optional `count` renders a muted number after a label.
