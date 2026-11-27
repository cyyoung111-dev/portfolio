// Published 2026-2027 US market holiday schedules. NYSE: nyse.com/trade/hours-calendars
// SIFMA: sifma.org/resources/general/holiday-schedule
// SIFMA early-close sessions are OPEN; a full close alone skips a session.
// This calendar controls briefing expected dates, not trading or settlement.
const EQUITY_2026=new Set(['2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25']);
const BOND_2026=new Set(['2026-01-01','2026-01-19','2026-02-16','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-10-12','2026-11-11','2026-11-26','2026-12-25']);
// NYSE 2027 official calendar; SIFMA 2027 recommendation announced 2025-12-17,
// full dates crosschecked against SEC-filed 2026-10 prospectus
// https://www.sec.gov/Archives/edgar/data/1060517/000119312526419195/d131592d485apos.htm
// Good Friday 2027 is a full bond close, unlike 2026; early closes remain OPEN.
const EQUITY_2027=new Set(['2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31','2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24']);
const BOND_2027=new Set([...EQUITY_2027,'2027-10-11','2027-11-11']);
const CALENDARS={2026:{EQUITY:EQUITY_2026,BOND:BOND_2026},2027:{EQUITY:EQUITY_2027,BOND:BOND_2027}};
export function usSessionStatus(date,market='EQUITY'){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return 'UNKNOWN';
 const parsed=new Date(date+'T00:00:00Z');
 if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)return 'UNKNOWN';
 if([0,6].includes(parsed.getUTCDay()))return 'CLOSED';
 const holidays=CALENDARS[date.slice(0,4)]?.[market];
 return holidays instanceof Set?(holidays.has(date)?'CLOSED':'OPEN'):'UNKNOWN';
}
