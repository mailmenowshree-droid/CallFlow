"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Activity, CalendarDays, CheckCircle2, Clock3, FileBarChart2, LayoutDashboard, Plus, Search, Users, X, SkipForward } from "lucide-react";

type Kind = "FE" | "CRU" | "Event" | "FTS";
type Status = "Scheduled" | "In Progress" | "Completed" | "Needs attention" | "Cancelled";
type Role = "Engineer" | "SSE" | "Team Lead" | "Manager";
type Area = "Overview" | "Assignments" | "Team" | "Leaves" | "Reports";
type TeamView = "Roster" | "Attendance" | "Rotations";
type Engineer = { id: string; name: string; role: Role; callQueue: boolean; ftsQueue: boolean; active: boolean; absent?: boolean; attendanceStatus?: "Present"|"Absent"|"Not checked in"; attendanceWorkMode?:"Office"|"WFH"; leaveUntil?: string };
type Call = { id: string; kind: Kind; caseNumber: string; engineer: string; engineerId?: string; date: string; time: string; notes: string; status: Status; manual?: boolean };
type SessionUser = { id: string; email: string; name: string; role: Role };
type ApiAssignment = { id: string; kind: Kind; caseNumber: string; engineerId: string; scheduledStartAt: string; scheduledEndAt: string; notes?: string; status: Status; manual?: boolean };
type LeaveItem = { id:string; engineerId:string; engineerName:string; startDate:string; endDate:string; reason:string; status:"Pending"|"Approved"|"Rejected"|"Cancelled" };
type ReportData = { counts:{total:number;completed:number;scheduled:number;inProgress:number;needsAttention:number;cancelled:number;lateOrMissed:number}; team:{activeMembers:number;checkedIn:number;absent:number;notCheckedIn:number;approvedLeavePersonDays:number;capacityPersonDays:number;shrinkagePercent:number}; rows:Array<{id:string;caseNumber:string;kind:Kind;engineer:string;scheduledStartAt:string;status:Status;lateOrMissed:boolean;manual:boolean;notes:string}> };
function dateTimeParts(iso: string) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)); const p = Object.fromEntries(parts.map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }; }
type Rotation = "FE_CRU_EVENT" | "FTS";
const slots = Array.from({length:48},(_,i)=>`${String(Math.floor(i/2)).padStart(2,"0")}:${i%2===0?"00":"30"}`);
const rotationFor = (kind: Kind): Rotation => kind === "FTS" ? "FTS" : "FE_CRU_EVENT";
const statusClass: Record<Status,string> = {"Scheduled":"status-blue","In Progress":"status-purple","Completed":"status-green","Needs attention":"status-red","Cancelled":"status-muted"};
function Pill({children,status}:{children:React.ReactNode;status?:Status}) { return <span className={`status-pill ${status?statusClass[status]:"status-muted"}`}>{children}</span>; }
function localDate() { const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()); const p=Object.fromEntries(parts.map(x=>[x.type,x.value])); return `${p.year}-${p.month}-${p.day}`; }
function minutesLate(call:Call) { const nowParts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()); const p=Object.fromEntries(nowParts.map(x=>[x.type,x.value])); const now=Number(p.hour)*60+Number(p.minute); const scheduled=Number(call.time.slice(0,2))*60+Number(call.time.slice(3,5)); return call.date<localDate()?1440:call.date>localDate()?-1440:now-scheduled; }

export default function Home() {
 const [area,setArea] = useState<Area>("Overview");
 const [teamView,setTeamView] = useState<TeamView>("Roster");
 const [engineers,setEngineers] = useState<Engineer[]>([]);
 const [calls,setCalls] = useState<Call[]>([]);
 const [leaves,setLeaves] = useState<LeaveItem[]>([]);
 const [reportData,setReportData] = useState<ReportData|null>(null);
 const [leaveStart,setLeaveStart] = useState(localDate());
 const [leaveEnd,setLeaveEnd] = useState(localDate());
 const [leaveReason,setLeaveReason] = useState("");
 const [reportStart,setReportStart] = useState(localDate());
 const [reportEnd,setReportEnd] = useState(localDate());
 const [sessionUser,setSessionUser] = useState<SessionUser|null>(null);
 const [authReady,setAuthReady] = useState(false);
 const [authEmail,setAuthEmail] = useState("");
 const [authPassword,setAuthPassword] = useState("");
 const [authBusy,setAuthBusy] = useState(false);
 const [authError,setAuthError] = useState("");
 const [newUserEmail,setNewUserEmail] = useState("");
 const [newUserPassword,setNewUserPassword] = useState("");
 const [newUserRole,setNewUserRole] = useState<Role>("Engineer");
 const [query,setQuery] = useState("");
 const [assignmentView,setAssignmentView] = useState<"All"|"Schedule">("All");
 const [statusFilter,setStatusFilter] = useState<"All"|Status>("All");
 const [showNew,setShowNew] = useState(false);
 const [kind,setKind] = useState<Kind>("FE");
 const [caseNumber,setCaseNumber] = useState("");
 const [date,setDate] = useState(localDate());
 const [time,setTime] = useState("12:00");
 const [manualEngineer,setManualEngineer] = useState("");
 const [notes,setNotes] = useState("");
 const [notice,setNotice] = useState("");
 const [rotationIndex,setRotationIndex] = useState<Record<Rotation,number>>({FE_CRU_EVENT:0,FTS:0});
 const [completedByRotation,setCompletedByRotation] = useState<Record<Rotation,number>>({FE_CRU_EVENT:0,FTS:0});
 const [skipUntil,setSkipUntil] = useState<Record<string,number>>({});
 const [newName,setNewName] = useState("");
 const [newRole,setNewRole] = useState<Role>("Engineer");
 const [newCallQueue,setNewCallQueue] = useState(true);
 const [newFtsQueue,setNewFtsQueue] = useState(true);
 const today = localDate();
 const loadWorkspace = async () => {
   const [teamResponse, assignmentResponse, leaveResponse] = await Promise.all([fetch("/api/engineers", { cache: "no-store" }), fetch("/api/assignments", { cache: "no-store" }), fetch("/api/leaves", { cache: "no-store" })]);
   if (!teamResponse.ok || !assignmentResponse.ok || !leaveResponse.ok) throw new Error("Could not load CallFlow data. Check your access and database configuration.");
   const teamData = await teamResponse.json();
   const assignmentData = await assignmentResponse.json();
   const leaveData = await leaveResponse.json();
   setLeaves(leaveData.leaves ?? []);
   const team: Engineer[] = (teamData.engineers ?? []).map((e: Engineer) => ({ ...e, absent: Boolean(e.absent), attendanceStatus: e.absent ? "Absent" : e.attendanceStatus ?? "Not checked in" }));
   setEngineers(team);
   const byId = new Map(team.map(e => [e.id, e]));
   setCalls((assignmentData.assignments ?? []).map((a: ApiAssignment) => {
     const dt = dateTimeParts(a.scheduledStartAt);
     return { id: a.id, kind: a.kind, caseNumber: a.caseNumber, engineerId: a.engineerId, engineer: byId.get(a.engineerId)?.name ?? "Unassigned member", date: dt.date, time: dt.time, notes: a.notes ?? "", status: a.status, manual: Boolean(a.manual) };
   }));
 };
 useEffect(() => {
   let alive = true;
   (async () => {
     try {
       const response = await fetch("/api/auth/me", { cache: "no-store" });
       if (response.ok) {
         const data = await response.json();
         if (!alive) return;
         await loadWorkspace();
         if (!alive) return;
         setSessionUser(data.user);
       }
     } catch (error) {
       if (alive) setAuthError(error instanceof Error ? error.message : "Unable to connect to CallFlow.");
     } finally {
       if (alive) setAuthReady(true);
     }
   })();
   return () => { alive = false; };
 }, []);
 const handleLogin = async (e: FormEvent) => {
   e.preventDefault(); setAuthBusy(true); setAuthError("");
   try {
     const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: authEmail, password: authPassword }) });
     const data = await response.json();
     if (!response.ok) throw new Error(data.error ?? "Sign-in failed.");
     await loadWorkspace();
     setSessionUser(data.user);
     setAuthPassword("");
   } catch (error) {
     setAuthError(error instanceof Error ? error.message : "Sign-in failed.");
   } finally { setAuthBusy(false); }
 };
 const handleLogout = async () => {
   await fetch("/api/auth/logout", { method: "POST" });
   setSessionUser(null); setEngineers([]); setCalls([]);
 };
 const thresholdCalls = calls.filter(c=>c.date<=today&&c.status!=="Completed"&&c.status!=="Cancelled"&&minutesLate(c)>=5);
 const escalatedCalls = thresholdCalls.filter(c=>minutesLate(c)>=10);
 const getNext = (rotation:Rotation) => {
   const members = engineers.filter(e=>e.active&&!e.absent&&e.role==="Engineer"&&(rotation==="FTS"?e.ftsQueue:e.callQueue));
   if(!members.length) return undefined;
   for(let offset=0;offset<members.length;offset++){
     const idx=(rotationIndex[rotation]+offset)%members.length, candidate=members[idx];
     if((skipUntil[`${rotation}:${candidate.id}`]??0)>completedByRotation[rotation]) continue;
     const busy=calls.some(c=>c.engineer===candidate.name&&c.date===date&&c.status!=="Cancelled"&&c.status!=="Completed"&&c.time===time);
     if(!busy) return candidate;
   }
   return undefined;
 };
 const filtered = useMemo(()=>calls.filter(c=>{
   const matches = `${c.id} ${c.caseNumber} ${c.engineer} ${c.kind} ${c.notes}`.toLowerCase().includes(query.toLowerCase());
   return matches&&(statusFilter==="All"||c.status===statusFilter)&&(assignmentView==="All"||c.date>=today);
 }),[calls,query,statusFilter,assignmentView,today]);
 const createAssignment = async (e:FormEvent) => {
   e.preventDefault();
   if(!caseNumber.trim()||!date||!time){setNotice("Enter a case number, date and time.");return;}
   const selected=manualEngineer?engineers.find(x=>x.name===manualEngineer&&x.active):undefined;
   if(manualEngineer&&!selected){setNotice("Choose an active team member for the manual assignment.");return;}
   const scheduledStartAt=new Date(`${date}T${time}:00+05:30`).toISOString();
   try {
     const response=await fetch("/api/assignments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind,caseNumber:caseNumber.trim(),scheduledStartAt,notes:notes.trim(),manualEngineerId:selected?.id})});
     const data=await response.json();
     if(!response.ok) throw new Error(data.error??"Could not create assignment.");
     const a:ApiAssignment=data.assignment;
     const dt=dateTimeParts(a.scheduledStartAt);
     const item:Call={id:a.id,kind:a.kind,caseNumber:a.caseNumber,engineerId:a.engineerId,engineer:engineers.find(x=>x.id===a.engineerId)?.name??"Assigned engineer",date:dt.date,time:dt.time,notes:a.notes??"",status:a.status,manual:Boolean(selected)};
     setCalls(prev=>[item,...prev]);
     setShowNew(false);setCaseNumber("");setNotes("");setManualEngineer("");setNotice(`Assignment created for ${item.engineer}.`);
   } catch(error) { setNotice(error instanceof Error?error.message:"Could not create assignment."); }
 };
 const updateEngineer = async (id:string,patch:Partial<Engineer>) => {
   try {
     const response=await fetch(`/api/engineers/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(patch)});
     const data=await response.json();
     if(!response.ok) throw new Error(data.error??"Could not update team member.");
     setEngineers(prev=>prev.map(e=>e.id===id?{...e,...data.engineer}:e));
     setNotice("Team member updated.");
   } catch(error) { setNotice(error instanceof Error?error.message:"Could not update team member."); }
 };
 const createUserAccount = async (e:FormEvent) => {
   e.preventDefault();
   try {
     const response=await fetch("/api/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:newName,email:newUserEmail,password:newUserPassword,role:newUserRole,callQueue:newUserRole==="Engineer"&&newCallQueue,ftsQueue:newUserRole==="Engineer"&&newFtsQueue})});
     const data=await response.json();
     if(!response.ok) throw new Error(data.error??"Could not create account.");
     if(data.engineerCreated) await loadWorkspace();
     setNewName("");setNewUserEmail("");setNewUserPassword("");setNotice(`Account created for ${data.user.email}.`);
   } catch(error) { setNotice(error instanceof Error?error.message:"Could not create account."); }
 };
 const updateAttendance = async (id:string,action:"check-in"|"check-out",workMode?:"Office"|"WFH") => {
   try {
     const response=await fetch("/api/attendance",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,engineerId:id,workMode})});
     const data=await response.json();
     if(!response.ok) throw new Error(data.error??"Could not update attendance.");
     setEngineers(prev=>prev.map(member=>member.id===id?{...member,attendanceStatus:data.attendanceStatus,attendanceWorkMode:data.workMode,absent:false}:member));
     setNotice(action==="check-in"?(workMode==="WFH"?"WFH attendance recorded.":"Office attendance recorded."):"Attendance check-out recorded.");
   } catch(error) { setNotice(error instanceof Error?error.message:"Could not update attendance."); }
 };
 const submitLeave = async (e:FormEvent) => {
   e.preventDefault();
   try {
     const response = await fetch("/api/leaves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startDate: leaveStart, endDate: leaveEnd, reason: leaveReason }) });
     const data = await response.json();
     if (!response.ok) throw new Error(data.error ?? "Could not submit leave.");
     setLeaves(prev => [data.leave, ...prev]); setLeaveReason(""); setNotice("Leave request submitted for manager review.");
   } catch (error) { setNotice(error instanceof Error ? error.message : "Could not submit leave."); }
 };
 const updateLeaveStatus = async (leave:LeaveItem,status:LeaveItem["status"]) => {
   try {
     const response=await fetch(`/api/leaves/${leave.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});
     const data=await response.json();
     if(!response.ok) throw new Error(data.error??"Could not update leave request.");
     setLeaves(prev=>prev.map(item=>item.id===leave.id?{...item,status:data.status}:item));
     setNotice(`Leave request ${status.toLowerCase()}.`);
   } catch(error) { setNotice(error instanceof Error?error.message:"Could not update leave request."); }
 };
 const addEngineer = async (e:FormEvent) => {
   e.preventDefault();
   const name=newName.trim();
   if(!name){setNotice("Enter a name.");return;}
   try {
     const response=await fetch("/api/engineers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,role:newRole,callQueue:newRole==="Engineer"&&newCallQueue,ftsQueue:newRole==="Engineer"&&newFtsQueue})});
     const data=await response.json();
     if(!response.ok) throw new Error(data.error??"Could not add team member.");
     setEngineers(prev=>[...prev,data.engineer]);setNewName("");setNotice("Team member added.");
   } catch(error) { setNotice(error instanceof Error?error.message:"Could not add team member."); }
 };
 const skipNext = async (rotation:Rotation) => {
   try {
     const response=await fetch("/api/rotations/skip",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rotation})});
     const data=await response.json();
     if(!response.ok) throw new Error(data.error??"Could not apply rotation skip.");
     setSkipUntil(p=>({...p,[`${rotation}:${data.engineerId}`]:completedByRotation[rotation]+3}));
     const members=engineers.filter(e=>e.active&&e.role==="Engineer"&&(rotation==="FTS"?e.ftsQueue:e.callQueue));
     const idx=members.findIndex(e=>e.id===data.engineerId);setRotationIndex(p=>({...p,[rotation]:(idx+1)%Math.max(1,members.length)}));
     setNotice(`${data.engineerName} skipped for the next three completed assignments in this rotation.`);
   } catch(error) { setNotice(error instanceof Error?error.message:"Could not apply rotation skip."); }
 };
 const changeStatus = async (call:Call,status:Status) => {
   if(call.status==="Completed"||call.status==="Cancelled") return;
   try {
     const response=await fetch(`/api/assignments/${call.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});
     const data=await response.json();
     if(!response.ok) throw new Error(data.error??"Could not update assignment.");
     setCalls(prev=>prev.map(c=>c.id===call.id?{...c,status:data.assignment.status}:c));
     if(status==="Completed"){const r=rotationFor(call.kind);setCompletedByRotation(p=>({...p,[r]:p[r]+1}));}
     setNotice(`Assignment ${call.caseNumber} updated to ${status}.`);
   } catch(error) { setNotice(error instanceof Error?error.message:"Could not update assignment."); }
 };
 const nav: {label:Area;icon:typeof LayoutDashboard}[]=[{label:"Overview",icon:LayoutDashboard},{label:"Assignments",icon:CalendarDays},{label:"Team",icon:Users},{label:"Leaves",icon:CalendarDays},{label:"Reports",icon:FileBarChart2}];
 if (!authReady) return <main className="minimal-app"><div className="login-panel"><h1>CallFlow</h1><p>Loading your workspace…</p></div></main>;
 if (!sessionUser) return <main className="minimal-app"><section className="login-panel"><div className="brand-mark"><Activity size={22}/></div><h1>Sign in to CallFlow</h1><p className="muted">Secure access to team operations and assignments.</p><form className="assignment-form" onSubmit={handleLogin}><label>Email<input className="field" type="email" autoComplete="username" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} required/></label><label>Password<input className="field" type="password" autoComplete="current-password" value={authPassword} onChange={e=>setAuthPassword(e.target.value)} required/></label>{authError&&<p className="auth-error" role="alert">{authError}</p>}<button className="button primary" type="submit" disabled={authBusy}>{authBusy?"Signing in…":"Sign in"}</button></form></section></main>;
 return <main className="minimal-app">
  <header className="minimal-header">
   <a className="brand" href="#" onClick={e=>{e.preventDefault();setArea("Overview");}}><span className="brand-mark"><Activity size={19}/></span><span>CallFlow</span></a>
   <nav className="top-nav" aria-label="Main navigation">{nav.map(n=><button key={n.label} onClick={()=>setArea(n.label)} className={area===n.label?"selected":""}>{n.label}</button>)}</nav>
   <button className="button primary compact" onClick={()=>{setShowNew(true);setNotice("");}}><Plus size={16}/> New assignment</button><div className="session-chip"><span>{sessionUser.name}</span><button className="text-button" onClick={handleLogout}>Sign out</button></div>
  </header>
  <div className="page-wrap">
   {notice&&<div className="notice" role="status">{notice}<button aria-label="Dismiss" onClick={()=>setNotice("")}><X size={15}/></button></div>}
   {area==="Overview"&&thresholdCalls.length>0&&<div className={escalatedCalls.length?"alert-banner alert-critical":"alert-banner alert-warning"} role="alert"><span className="alert-symbol"><Activity size={19}/></span><div className="alert-copy"><strong>{escalatedCalls.length? "Escalation required":"Calls running late"}</strong><span>{escalatedCalls.length? `${escalatedCalls.length} call(s) have crossed the 10-minute escalation threshold.`:`${thresholdCalls.length} call(s) are at least 5 minutes past their scheduled time.`}</span></div><button className="alert-action" onClick={()=>{setArea("Assignments");setStatusFilter("All");setQuery("");}}>Review calls</button></div>}
   {area==="Overview"&&<>
    <div className="page-heading"><div><p className="eyebrow">{today}</p><h1>Overview</h1><p className="muted">Today's call assignment activity.</p></div><button className="button primary" onClick={()=>setShowNew(true)}><Plus size={16}/> New assignment</button></div>
    <section className="metric-grid tl-metrics">
     {[{label:"Present",value:engineers.filter(e=>e.active&&e.attendanceStatus==="Present").length,tone:"green",action:()=>{setArea("Team");setTeamView("Attendance");}},{label:"Absent",value:engineers.filter(e=>e.active&&(e.absent||e.attendanceStatus==="Absent")).length,tone:"red",action:()=>{setArea("Team");setTeamView("Attendance");}},{label:"Manual assignments",value:calls.filter(c=>c.date===today&&c.manual).length,tone:"blue",action:()=>{setArea("Assignments");setQuery("");setStatusFilter("All");}},{label:"Prescheduled calls",value:calls.filter(c=>c.date===today&&c.status==="Scheduled").length,tone:"purple",action:()=>{setArea("Assignments");setAssignmentView("Schedule");setStatusFilter("Scheduled");}},{label:"Urgent",value:calls.filter(c=>c.date===today&&(c.status==="Needs attention"||minutesLate(c)>=10)&&c.status!=="Completed"&&c.status!=="Cancelled").length,tone:"red",action:()=>{setArea("Assignments");setStatusFilter("Needs attention");}},{label:"In progress",value:calls.filter(c=>c.date===today&&c.status==="In Progress").length,tone:"amber",action:()=>{setArea("Assignments");setStatusFilter("In Progress");}}].map(m=><button className={"metric metric-"+m.tone} key={m.label} onClick={m.action}><span>{m.label}</span><strong>{m.value}</strong><small>View details →</small></button>)}
    </section>
    <section className="surface"><div className="section-head"><div><h2>Urgent attention</h2><p className="muted">Escalations first, then calls needing follow-up.</p></div><button className="text-button" onClick={()=>{setArea("Assignments");setStatusFilter("Needs attention");setQuery("");}}>Review all →</button></div>
     {(()=>{const urgent=calls.filter(c=>c.date===today&&c.status!=="Completed"&&c.status!=="Cancelled"&&(c.status==="Needs attention"||minutesLate(c)>=10)).sort((a,b)=>minutesLate(b)-minutesLate(a));return urgent.length?<CallTable calls={urgent.slice(0,5)} onStatus={changeStatus} emptyMessage="No urgent calls."/>:<p className="empty">No urgent calls right now.</p>})()}
    </section>
    <section className="surface"><div className="section-head"><div><h2>Today's prescheduled calls</h2><p className="muted">Upcoming calls and their current owners.</p></div><button className="text-button" onClick={()=>{setArea("Assignments");setAssignmentView("Schedule");setStatusFilter("All");}}>Full schedule →</button></div>
     <CallTable calls={calls.filter(c=>c.date===today&&c.status!=="Cancelled").slice().sort((a,b)=>a.time.localeCompare(b.time)).slice(0,8)} onStatus={changeStatus}/>
     {calls.filter(c=>c.date===today&&c.status!=="Cancelled").length===0&&<p className="empty">No calls scheduled for today.</p>}
    </section>
    <section className="surface"><div className="section-head"><div><h2>On call now</h2><p className="muted">Engineers currently handling calls, plus the next rotation candidates.</p></div><button className="text-button" onClick={()=>{setArea("Team");setTeamView("Rotations");}}>Rotation details →</button></div>
     <div className="oncall-grid">{(["FE_CRU_EVENT","FTS"] as Rotation[]).map(r=>{const activeCall=calls.find(c=>c.date===today&&c.status==="In Progress"&&rotationFor(c.kind)===r);return <div className="oncall-card" key={r}><span className="oncall-dot"/><div><strong>{r==="FTS"?"FTS":"FE · CRU · Event"}</strong><p>{activeCall?activeCall.engineer:getNext(r)?.name??"No eligible engineer"}</p><small>{activeCall?"Handling "+activeCall.caseNumber:"Next eligible in rotation"}</small></div><Pill status={activeCall?"In Progress":"Scheduled"}>{activeCall?"On call":"Next up"}</Pill></div>})}</div>
    </section>
    <section className="surface"><div className="section-head"><div><h2>Rotation queues</h2><p className="muted">Two independent queues; engineers can belong to both.</p></div><button className="text-button" onClick={()=>{setArea("Team");setTeamView("Rotations");}}>Manage queues →</button></div>
     <div className="queue-grid">{(["FE_CRU_EVENT","FTS"] as Rotation[]).map(r=><div className="queue" key={r}><div><h3>{r==="FTS"?"FTS monitoring":"FE · CRU · Event"}</h3><p className="muted">{r==="FTS"?"Follow-the-sun queue":"Shared customer-call queue"}</p></div><div className="queue-bottom"><span>{engineers.filter(e=>e.active&&e.role==="Engineer"&&(r==="FTS"?e.ftsQueue:e.callQueue)).length} eligible engineers</span><button className="button subtle" onClick={()=>skipNext(r)}><SkipForward size={14}/> Skip next</button></div><p className="next-up">Next: {getNext(r)?.name??"No eligible engineer"}</p></div>)}</div>
    </section>
   </>}
   {area==="Assignments"&&<><div className="page-heading"><div><p className="eyebrow">WORKSPACE</p><h1>Assignments</h1><p className="muted">Create, schedule and update call assignments in one place.</p></div><button className="button primary" onClick={()=>setShowNew(true)}><Plus size={16}/> New assignment</button></div>
    <div className="toolbar"><div className="segmented">{(["All","Schedule"] as const).map(v=><button key={v} className={assignmentView===v?"active":""} onClick={()=>setAssignmentView(v)}>{v==="All"?"All assignments":"Schedule"}</button>)}</div><label className="search-box"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search case, engineer, notes"/></label><select aria-label="Filter by status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value as typeof statusFilter)}><option value="All">All statuses</option>{(["Scheduled","In Progress","Completed","Needs attention","Cancelled"] as Status[]).map(s=><option key={s}>{s}</option>)}</select></div>
    <section className="surface table-surface"><CallTable calls={filtered.slice().sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time))} onStatus={changeStatus} emptyMessage="No assignments match these filters."/></section>
   </>}
   {area==="Team"&&<><div className="page-heading"><div><p className="eyebrow">PEOPLE & AVAILABILITY</p><h1>Team</h1><p className="muted">Manage team members, attendance and rotation membership.</p></div></div>
    <div className="toolbar team-toolbar"><div className="segmented">{(["Roster","Attendance","Rotations"] as TeamView[]).map(v=><button key={v} className={teamView===v?"active":""} onClick={()=>setTeamView(v)}>{v}</button>)}</div><span className="muted">{engineers.filter(e=>e.active).length} active team members</span></div>
    {teamView==="Roster"&&<><form className="add-member" onSubmit={addEngineer}><input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Add team member name" aria-label="Team member name" required/><select value={newRole} onChange={e=>setNewRole(e.target.value as Role)} aria-label="Role"><option>Engineer</option><option>SSE</option><option>Team Lead</option><option>Manager</option></select><label><input type="checkbox" checked={newCallQueue} onChange={e=>setNewCallQueue(e.target.checked)}/> Call queue</label><label><input type="checkbox" checked={newFtsQueue} onChange={e=>setNewFtsQueue(e.target.checked)}/> FTS</label><button className="button primary" type="submit"><Plus size={15}/> Add</button></form>
     <section className="surface table-surface"><table className="data-table"><thead><tr><th>Team member</th><th>Role</th><th>Queues</th><th>Status</th><th></th></tr></thead><tbody>{engineers.map(e=><tr key={e.id}><td><strong>{e.name}</strong><small>{e.id}</small></td><td><select value={e.role} aria-label={`Role for ${e.name}`} onChange={ev=>updateEngineer(e.id,{role:ev.target.value as Role,callQueue:ev.target.value==="Engineer"?e.callQueue:false,ftsQueue:["Team Lead","Manager","SSE"].includes(ev.target.value)?false:e.ftsQueue})}><option>Engineer</option><option>SSE</option><option>Team Lead</option><option>Manager</option></select></td><td><div className="queue-checks"><label><input type="checkbox" checked={e.callQueue} disabled={e.role!=="Engineer"} onChange={ev=>updateEngineer(e.id,{callQueue:ev.target.checked})}/> Calls</label><label><input type="checkbox" checked={e.ftsQueue} disabled={e.role!=="Engineer"} onChange={ev=>updateEngineer(e.id,{ftsQueue:ev.target.checked})}/> FTS</label></div></td><td><Pill>{!e.active?"Inactive":e.absent?"Absent":e.attendanceStatus??"Not checked in"}</Pill></td><td><button className="text-button" onClick={()=>updateEngineer(e.id,{absent:!e.absent})}>{e.absent?"Mark present":"Mark absent"}</button></td></tr>)}</tbody></table><p className="table-note">Roster changes are saved to CallFlow.</p></section>{sessionUser.role==="Manager"&&<section className="surface account-panel"><div className="section-head"><div><h2>Create user access</h2><p className="muted">Create a login for a Team Lead or team member. Password must be at least 14 characters.</p></div></div><form className="add-member account-form" onSubmit={createUserAccount}><input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Full name" aria-label="Account full name" required/><input type="email" value={newUserEmail} onChange={e=>setNewUserEmail(e.target.value)} placeholder="Work email" aria-label="Work email" required/><input type="password" minLength={14} value={newUserPassword} onChange={e=>setNewUserPassword(e.target.value)} placeholder="Temporary password (14+ chars)" aria-label="Temporary password" required/><select value={newUserRole} onChange={e=>setNewUserRole(e.target.value as Role)} aria-label="Account role"><option>Engineer</option><option>SSE</option><option>Team Lead</option></select>{newUserRole==="Engineer"&&<><label><input type="checkbox" checked={newCallQueue} onChange={e=>setNewCallQueue(e.target.checked)}/> Call queue</label><label><input type="checkbox" checked={newFtsQueue} onChange={e=>setNewFtsQueue(e.target.checked)}/> FTS queue</label></>}<button className="button primary" type="submit">Create account</button></form></section>}</>}
    {teamView==="Attendance"&&<section className="surface table-surface"><table className="data-table"><thead><tr><th>Team member</th><th>Role</th><th>Attendance</th><th>Assignment eligibility</th><th></th></tr></thead><tbody>{engineers.map(e=><tr key={e.id}><td><strong>{e.name}</strong></td><td>{e.role}</td><td><Pill>{e.absent?"Absent":e.attendanceStatus??"Not checked in"}</Pill>{e.attendanceStatus==="Present"&&e.attendanceWorkMode?<small className="table-note">{e.attendanceWorkMode}</small>:null}</td><td>{e.role==="Team Lead"||e.role==="Manager"?"Not in rotation":e.role==="SSE"?"Manual assignment only":e.absent?"Excluded while absent":"Queue membership applies"}</td><td>{e.attendanceStatus==="Present"?<button className="text-button" onClick={()=>updateAttendance(e.id,"check-out")}>Check out</button>:<div className="inline-actions"><button className="text-button" onClick={()=>updateAttendance(e.id,"check-in","Office")}>Office</button><button className="text-button" onClick={()=>updateAttendance(e.id,"check-in","WFH")}>WFH</button></div>}</td></tr>)}</tbody></table><p className="table-note">Check-in/out events are timestamped and audited. Team Leads can record attendance for their roster.</p></section>}
    {teamView==="Rotations"&&<div className="queue-grid">{(["FE_CRU_EVENT","FTS"] as Rotation[]).map(r=><section className="surface queue-settings" key={r}><h2>{r==="FTS"?"FTS monitoring queue":"FE · CRU · Event queue"}</h2><p className="muted">{r==="FTS"?"Follow-the-sun assignments":"Shared call assignment rotation"}</p><p className="next-up">Next in rotation: {getNext(r)?.name??"No eligible engineer"}</p><div className="member-list">{engineers.filter(e=>e.active&&(r==="FTS"?e.ftsQueue:e.callQueue)).map(e=><div key={e.id}><span>{e.name}</span><Pill>{e.role==="SSE"?"Manual only":e.absent?"Absent":"In queue"}</Pill></div>)}</div><button className="button subtle" onClick={()=>skipNext(r)}><SkipForward size={14}/> Skip next engineer</button></section>)}</div>}
   </>}
   {area==="Leaves"&&<><div className="page-heading"><div><p className="eyebrow">PLANNING & APPROVALS</p><h1>Leave calendar</h1><p className="muted">Maximum two people may be on leave for any day. Pending requests reserve capacity.</p></div></div>
    <div className="leave-layout"><section className="surface"><div className="section-head"><div><h2>Apply for leave</h2><p className="muted">Choose dates and give a short reason.</p></div></div><form className="assignment-form" onSubmit={submitLeave}><div className="form-row"><label>Start date<input type="date" required value={leaveStart} min={today} onChange={e=>{setLeaveStart(e.target.value);if(leaveEnd<e.target.value)setLeaveEnd(e.target.value);}}/></label><label>End date<input type="date" required min={leaveStart} value={leaveEnd} onChange={e=>setLeaveEnd(e.target.value)}/></label></div><label>Reason<textarea rows={3} maxLength={500} required value={leaveReason} onChange={e=>setLeaveReason(e.target.value)} placeholder="Reason for leave"/></label><button className="button primary" type="submit">Submit request</button></form></section>
    <section className="surface"><div className="section-head"><div><h2>Leave planning</h2><p className="muted">Daily usage includes pending and approved requests.</p></div></div><div className="leave-calendar-grid">{Array.from({length:14},(_,i)=>{const d=new Date(today+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+i);const key=d.toISOString().slice(0,10);const count=leaves.filter(l=>(l.status==="Pending"||l.status==="Approved")&&l.startDate<=key&&l.endDate>=key).length;return <div className={count>=2?"leave-day full":count===1?"leave-day partial":"leave-day"} key={key}><strong>{d.toLocaleDateString("en-IN",{timeZone:"UTC",weekday:"short",day:"numeric",month:"short"})}</strong><span>{count}/2 slots used</span>{count>=2&&<small>Full</small>}</div>})}</div></section></div>
    <section className="surface table-surface"><div className="section-head"><div><h2>Requests</h2><p className="muted">Managers and Team Leads can approve or reject. Applicants can cancel their own requests.</p></div></div>{leaves.length===0?<p className="empty">No leave requests yet.</p>:<div className="table-scroll"><table className="data-table"><thead><tr><th>Team member</th><th>Dates</th><th>Reason</th><th>Status</th><th>Action</th></tr></thead><tbody>{leaves.slice().sort((a,b)=>a.startDate.localeCompare(b.startDate)).map(l=><tr key={l.id}><td><strong>{l.engineerName}</strong></td><td>{l.startDate} – {l.endDate}</td><td>{l.reason}</td><td><Pill>{l.status}</Pill></td><td><div className="inline-actions">{(sessionUser.role==="Manager"||sessionUser.role==="Team Lead")&&l.status==="Pending"&&<><button className="text-button" onClick={()=>updateLeaveStatus(l,"Approved")}>Approve</button><button className="text-button" onClick={()=>updateLeaveStatus(l,"Rejected")}>Reject</button></>}{l.engineerId===sessionUser.id&&(l.status==="Pending"||l.status==="Approved")&&<button className="text-button" onClick={()=>updateLeaveStatus(l,"Cancelled")}>Cancel</button>}</div></td></tr>)}</tbody></table></div>}</section>
   </>}
   {area==="Reports"&&<><div className="page-heading"><div><p className="eyebrow">REPORTING</p><h1>Reports</h1><p className="muted">A simple snapshot of assignment outcomes.</p></div></div><section className="metric-grid">{(["Scheduled","In Progress","Completed","Needs attention","Cancelled"] as Status[]).map(s=><div className="metric report-metric" key={s}><span>{s}</span><strong>{calls.filter(c=>c.status===s).length}</strong></div>)}</section><section className="surface table-surface"><div className="section-head"><div><h2>Assignment history</h2><p className="muted">Searchable case and assignment records.</p></div><button className="button subtle" onClick={()=>{const rows=[["Assignment","Case","Type","Engineer","Date","Time","Status","Notes"],...calls.map(c=>[c.id,c.caseNumber,c.kind,c.engineer,c.date,c.time,c.status,c.notes])];const csv=rows.map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="callflow-report.csv";a.click();URL.revokeObjectURL(url);}}>Export CSV</button></div><CallTable calls={calls.slice().sort((a,b)=>b.date.localeCompare(a.date)||b.time.localeCompare(a.time))} onStatus={changeStatus}/></section></>}
   <p className="footnote">CallFlow operational workspace · Times displayed in IST</p>
  </div>
  {showNew&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setShowNew(false);}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-assignment-title"><div className="modal-head"><div><h2 id="new-assignment-title">New assignment</h2><p className="muted">Enter the call details and confirm the proposed engineer.</p></div><button className="icon-button" aria-label="Close" onClick={()=>setShowNew(false)}><X size={18}/></button></div><form className="assignment-form" onSubmit={createAssignment}><label>Assignment type<select value={kind} onChange={e=>setKind(e.target.value as Kind)}><option value="FE">FE — Field escalation</option><option value="CRU">CRU — Customer requested update</option><option value="Event">Event — Scheduled customer call</option><option value="FTS">FTS — Follow-the-sun</option></select></label><label>Case number<input required value={caseNumber} onChange={e=>setCaseNumber(e.target.value)} placeholder="Paste case number"/></label><div className="form-row"><label>Date (IST)<input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Time (IST)<select value={time} onChange={e=>setTime(e.target.value)}>{slots.map(s=><option key={s} value={s}>{new Date(`2000-01-01T${s}:00+05:30`).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:true,timeZone:"Asia/Kolkata"})}</option>)}</select></label></div><label>Manual assignment (optional)<select value={manualEngineer} onChange={e=>setManualEngineer(e.target.value)}><option value="">Use round-robin</option>{engineers.filter(e=>e.active&&!e.absent&&e.role!=="Team Lead"&&e.role!=="Manager").map(e=><option key={e.id} value={e.name}>{e.name}{e.role==="SSE"?" · SSE manual only":""}</option>)}</select></label><div className="assignment-preview"><span>Proposed engineer</span><strong>{(manualEngineer?engineers.find(e=>e.name===manualEngineer):getNext(rotationFor(kind)))?.name??"No eligible engineer"}</strong><small>{manualEngineer?"Manual assignment":kind==="FTS"?"FTS rotation":"Shared FE · CRU · Event rotation"} · IST</small>{!manualEngineer&&<button className="text-button" type="button" onClick={()=>skipNext(rotationFor(kind))}><SkipForward size={14}/> Skip next engineer</button>}</div><label>Notes (optional)<textarea rows={3} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Context or handoff notes"/></label><div className="modal-actions"><button className="button subtle" type="button" onClick={()=>setShowNew(false)}>Cancel</button><button className="button primary" type="submit">Confirm assignment</button></div></form></section></div>}
 </main>;
}

function CallTable({calls,onStatus,emptyMessage="No assignments yet."}:{calls:Call[];onStatus:(call:Call,status:Status)=>void;emptyMessage?:string}) {
 if(!calls.length)return <p className="empty">{emptyMessage}</p>;
 return <div className="table-scroll"><table className="data-table"><thead><tr><th>Case / assignment</th><th>Type</th><th>Assigned engineer</th><th>Scheduled (IST)</th><th>Notes</th><th>Status</th><th>Update</th></tr></thead><tbody>{calls.map(c=><tr key={c.id} className={c.status==="Needs attention"?"attention-row":c.status!=="Completed"&&c.status!=="Cancelled"&&minutesLate(c)>=10?"critical-row":c.status!=="Completed"&&c.status!=="Cancelled"&&minutesLate(c)>=5?"warning-row":""}><td><strong>{c.caseNumber}</strong><small>{c.id}</small></td><td>{c.kind}</td><td>{c.engineer}</td><td><span>{c.date}</span><small>{new Date(`2000-01-01T${c.time}:00+05:30`).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:true,timeZone:"Asia/Kolkata"})}</small></td><td className="notes-cell">{c.notes||"—"}</td><td><Pill status={c.status}>{c.status}</Pill></td><td>{c.status==="Completed"||c.status==="Cancelled"?<span className="muted">—</span>:<select aria-label={`Update status for ${c.caseNumber}`} value={c.status} onChange={e=>onStatus(c,e.target.value as Status)}><option>Scheduled</option><option>In Progress</option><option>Completed</option><option>Needs attention</option><option>Cancelled</option></select>}</td></tr>)}</tbody></table></div>;
}
