
import React from 'react'
import { updateDelegate, deleteDelegate } from '../store/bus.js'

export default function DelegatesTable({ state }){
  console.debug('[Talestolen] DelegatesTable render', Object.keys((state&&state.delegates)||{}).length)
  React.useEffect(()=>{ console.log('[Talestolen] DelegatesTable mounted'); }, [])
  const [editing, setEditing] = React.useState(null) // key of row being edited
  const [form, setForm] = React.useState({ number:'', name:'', org:'' })
  const delegates = state.delegates || {}
  const rows = Object.values(delegates).sort((a,b)=>{
    const ai = parseInt(a.number,10); const bi = parseInt(b.number,10);
    if (!Number.isNaN(ai) && !Number.isNaN(bi)) return ai - bi
    return String(a.number||'').localeCompare(String(b.number||''))
  })

  function startEdit(row){
    setEditing(row.number)
    setForm({ number: row.number||'', name: row.name||'', org: row.org||'' })
  }
  function cancelEdit(){ setEditing(null) }
  function saveEdit(){
    updateDelegate(editing, { number: form.number, name: form.name, org: form.org })
    setEditing(null)
  }

  return (
    <div className="card" style={{marginTop:16}}>
      <div className="title">Delegates</div>
      <div className="muted">Imported delegates are saved locally in your browser and can be edited here.</div>
      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{width:110}}>Nr</th>
              <th>Name</th>
              <th>Representerer</th>
              <th style={{width:200}}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length===0 ? (
              <tr><td colSpan={4} className="muted">No delegates loaded yet.</td></tr>
            ) : rows.map(row => (
              <tr key={row.number}>
                <td>
                  {editing===row.number ? (
                    <input className="input" value={form.number} onChange={e=>setForm(f=>({...f, number:e.target.value}))} />
                  ) : <span>#{row.number}</span>}
                </td>
                <td>
                  {editing===row.number ? (
                    <input className="input" value={form.name} onChange={e=>setForm(f=>({...f, name:e.target.value}))} placeholder="Navn" />
                  ) : (row.name || <span className="muted">—</span>)}
                </td>
                <td>
                  {editing===row.number ? (
                    <input className="input" value={form.org} onChange={e=>setForm(f=>({...f, org:e.target.value}))} placeholder="Representerer" />
                  ) : (row.org || <span className="muted">—</span>)}
                </td>
                <td>
                  {editing===row.number ? (
                    <div className="row" style={{gap:6}}>
                      <button className="btn" onClick={saveEdit}>Save</button>
                      <button className="btn ghost" onClick={cancelEdit}>Cancel</button>
                    </div>
                  ) : (
                    <div className="row" style={{gap:6}}>
                      <button className="btn" onClick={()=>startEdit(row)}>Edit</button>
                      <button className="btn danger" onClick={()=>deleteDelegate(row.number)}>Delete</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
