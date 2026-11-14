// Confirmed 2026 US exchange holiday dates. NYSE: nyse.com/trade/hours-calendars
// SIFMA: sifma.org/resources/general/holiday-schedule
// SIFMA early-close sessions are OPEN; a full close alone skips a session.
// This calendar controls briefing expected dates, not trading or settlement.
const EQUITY_2026=new Set(['2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25']);
const BOND_2026=new Set(['2026-01-01','2026-01-19','2026-02-16','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-10-12','2026-11-11','2026-11-26','2026-12-25']);
export function usSessionStatus(date,market='EQUITY'){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return 'UNKNOWN';
 const parsed=new Date(date+'T00:00:00Z');
 if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)return 'UNKNOWN';
 if([0,6].includes(parsed.getUTCDay()))return 'CLOSED';
 if(date.slice(0,4)!=='2026')return 'UNKNOWN';
 if(market==='EQUITY')return EQUITY_2026.has(date)?'CLOSED':'OPEN';
 if(market==='BOND')return BOND_2026.has(date)?'CLOSED':'OPEN';
 return 'UNKNOWN';
}
