import { createContext, useContext, useReducer, useCallback, useEffect } from 'react'
import { getTranslations } from '../i18n/index.js'

const STORE_KEY = 'homepi_store_v3'

export const DEFAULT_CONTRACT = {
  id:'default', name:'TEPCO Standard B', validFrom:'2024-01-01', currency:'JPY',
  scope:{ type:'global', id:null },
  utilities:{
    electricity:{ enabled:true, standingChargePerDay:50,
      tiers:[
        {id:'t1',label:'Tier 1',from:0,  to:120, ratePerKwh:29.80},
        {id:'t2',label:'Tier 2',from:120,to:300, ratePerKwh:36.40},
        {id:'t3',label:'Tier 3',from:300,to:null,ratePerKwh:40.49},
      ],
      peakSchedule:[
        {label:'Peak',    from:9, to:23,multiplier:1.0 },
        {label:'Off-peak',from:23,to:9, multiplier:0.85},
      ],
    },
    water:{ enabled:true,  ratePerM3:300, standingChargePerDay:10 },
    gas:  { enabled:false, ratePerM3:120, standingChargePerDay:15 },
  },
}

const DEFAULT_EDITOR = {
  snapEnabled:true, snapDist:15, showGrid:true, showMeasurements:true,
  measureUnit:'cm', defaultZoom:1.5, defaultWallThickness:10, defaultGridCm:20,
}

const DEFAULT_SETTINGS = {
  language:'en', theme:'dark', defaultTimeWindow:'h24', refreshInterval:15,
  editor:DEFAULT_EDITOR,
}

function load() {
  try { const r=localStorage.getItem(STORE_KEY); return r?JSON.parse(r):null } catch { return null }
}
function persist(s) { try { localStorage.setItem(STORE_KEY,JSON.stringify(s)) } catch {} }

const saved=load()
const initialState={
  settings:{ ...DEFAULT_SETTINGS,...(saved?.settings||{}), editor:{...DEFAULT_EDITOR,...(saved?.settings?.editor||{})} },
  contracts:{
    activeId: saved?.contracts?.activeId||'default',
    list:     saved?.contracts?.list?.length ? saved.contracts.list : [DEFAULT_CONTRACT],
    snapshots:saved?.contracts?.snapshots||[],
  },
}

function reducer(state,action){
  switch(action.type){
    case 'SET_SETTINGS_BULK':
      return {...state,settings:{...state.settings,...action.settings,editor:{...state.settings.editor,...(action.settings.editor||{})}}}
    case 'SET_SETTING':
      return {...state,settings:{...state.settings,[action.key]:action.value}}
    case 'SET_EDITOR_SETTING':
      return {...state,settings:{...state.settings,editor:{...state.settings.editor,[action.key]:action.value}}}
    case 'ADD_CONTRACT':{
      const c={...action.contract,id:`c-${Date.now()}`}
      return {...state,contracts:{...state.contracts,list:[...state.contracts.list,c]}}
    }
    case 'UPDATE_CONTRACT':{
      const old=state.contracts.list.find(c=>c.id===action.contract.id)
      const snap=old?{...old,archivedAt:new Date().toISOString()}:null
      return {...state,contracts:{...state.contracts,list:state.contracts.list.map(c=>c.id===action.contract.id?action.contract:c),snapshots:snap?[...state.contracts.snapshots,snap]:state.contracts.snapshots}}
    }
    case 'DELETE_CONTRACT':{
      const rest=state.contracts.list.filter(c=>c.id!==action.id)
      return {...state,contracts:{...state.contracts,list:rest,activeId:state.contracts.activeId===action.id?(rest[0]?.id||null):state.contracts.activeId}}
    }
    case 'SET_ACTIVE_CONTRACT':
      return {...state,contracts:{...state.contracts,activeId:action.id}}
    default: return state
  }
}

export const StoreContext = createContext(null)

export function StoreProvider({children}){
  const [state,dispatch]=useReducer(reducer,initialState)
  useEffect(()=>{ persist(state) },[state])

  const setSettingsBulk   = useCallback(s=>dispatch({type:'SET_SETTINGS_BULK',settings:s}),[])
  const setSetting        = useCallback((k,v)=>dispatch({type:'SET_SETTING',key:k,value:v}),[])
  const setEditorSetting  = useCallback((k,v)=>dispatch({type:'SET_EDITOR_SETTING',key:k,value:v}),[])
  const addContract       = useCallback(c=>dispatch({type:'ADD_CONTRACT',contract:c}),[])
  const updateContract    = useCallback(c=>dispatch({type:'UPDATE_CONTRACT',contract:c}),[])
  const deleteContract    = useCallback(id=>dispatch({type:'DELETE_CONTRACT',id}),[])
  const setActiveContract = useCallback(id=>dispatch({type:'SET_ACTIVE_CONTRACT',id}),[])
  const activeContract    = state.contracts.list.find(c=>c.id===state.contracts.activeId)||state.contracts.list[0]||DEFAULT_CONTRACT

  return(
    <StoreContext.Provider value={{state,setSetting,setSettingsBulk,setEditorSetting,addContract,updateContract,deleteContract,setActiveContract,activeContract}}>
      {children}
    </StoreContext.Provider>
  )
}

export function useStore(){
  const ctx=useContext(StoreContext)
  if(!ctx)throw new Error('useStore outside StoreProvider')
  return ctx
}

// Reactive translation hook — re-renders automatically when language changes
export function useT(){
  const ctx=useContext(StoreContext)
  return getTranslations(ctx?.state?.settings?.language)
}

export function computeElecCost(kwhTotal,contract){
  const elec=contract?.utilities?.electricity
  if(!elec?.enabled)return 0
  let remaining=kwhTotal, cost=(elec.standingChargePerDay||0)*30
  for(const tier of (elec.tiers||[])){
    if(remaining<=0)break
    const cap=tier.to!=null?tier.to-tier.from:Infinity
    const used=Math.min(remaining,cap)
    cost+=used*tier.ratePerKwh
    remaining-=used
  }
  return cost
}

// Build cumulative cost curve for pricing chart
export function buildCostCurve(tiers,maxKwh=600){
  const pts=[]
  let totalCost=0,prev=0
  for(const tier of tiers){
    const end=Math.min(tier.to??maxKwh,maxKwh)
    pts.push({kwh:prev,cost:totalCost,rate:tier.ratePerKwh})
    totalCost+=(end-prev)*tier.ratePerKwh
    pts.push({kwh:end,cost:totalCost,rate:tier.ratePerKwh})
    prev=end
    if(prev>=maxKwh)break
  }
  return pts
}