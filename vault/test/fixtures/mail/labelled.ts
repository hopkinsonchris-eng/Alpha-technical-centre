/**
 * Labelled mail for the classifier test (M10): 63 messages over four projects plus mail that belongs to none.
 * `expect` is the project a person would file it to; null means "must not be auto-filed to any project" (noise,
 * or genuinely ambiguous between two projects). `thread` seeds an earlier message of the conversation, already filed there.
 * `hard` marks a message the classifier is known to file wrongly: the fixture keeps it so the measured precision is honest.
 */
import type { ProjectId } from './seed.ts';

export interface Labelled {
  id: string; group: string; from: string; to?: string[]; cc?: string[]; folder?: 'inbox' | 'sent';
  subject: string; text: string; expect: ProjectId | null; thread?: ProjectId; hard?: boolean;
}
const INFO = 'info@alpha-technical-centre.com', CHRIS = 'chris@alpha-technical-centre.com';
const L = (id: string, group: string, from: string, subject: string, text: string, expect: ProjectId | null, more: Partial<Labelled> = {}): Labelled => ({ id, group, from, subject, text, expect, ...more });
const S = (id: string, to: string[], subject: string, text: string, expect: ProjectId | null, cc: string[] = []): Labelled => ({ id, group: 'sent', from: CHRIS, to, cc, folder: 'sent', subject, text, expect });
const LL = 'llanos-waterflood', MM = 'middle-magdalena', FR = 'ecopetrol-fiscal-review', TB = 'talara-brownfield';

export const LABELLED: Labelled[] = [
  // known contact, clear topic or none: the contact list alone decides
  L('a01', 'contact', 'Jorge Ruiz <jruiz@fronteraenergy.com>', 'Cubiro injection volumes for July', 'Attaching the monthly water injection volumes for Cubiro. Please confirm they match your records.', LL),
  L('a02', 'contact', 'Sofía Marín <smarin@fronteraenergy.com>', 'Re: waterflood pattern review', 'Thanks for the pattern review. We will look at the five-spot conversion next week.', LL),
  L('a03', 'contact', 'Jorge Ruiz <jruiz@fronteraenergy.com>', 'Castilla produced water handling', 'The handling capacity at the Castilla facility is 180 kbwpd; can that be a constraint in the screening?', LL),
  L('a04', 'contact', 'Sofía Marín <smarin@fronteraenergy.com>', 'Meeting Thursday', 'Can we meet Thursday to go over the numbers?', LL),
  L('a05', 'contact', 'Jorge Ruiz <jruiz@fronteraenergy.com>', 'Invoice question', 'Could you resend invoice 2026-014? Our accounts payable team cannot find it.', LL),
  L('a06', 'contact', 'Camila Vargas <cvargas@ecopetrol.com.co>', 'La Cira-Infantas infill locations', 'We have three additional infill locations for La Cira-Infantas. Coordinates attached.', MM),
  L('a07', 'contact', 'Pablo Torres <ptorres@ecopetrol.com.co>', 'Middle Magdalena: updated well list', 'Updated list of producers and injectors for the Middle Magdalena work, as of last Friday.', MM),
  L('a08', 'contact', 'Camila Vargas <cvargas@ecopetrol.com.co>', 'Casabe pressure data', 'Shut-in pressure surveys for Casabe wells, 2022 to 2026.', MM),
  L('a09', 'contact', 'Camila Vargas <cvargas@ecopetrol.com.co>', 'Schedule', 'Are you available on Monday for a call?', MM),
  L('a10', 'contact', 'Pablo Torres <ptorres@ecopetrol.com.co>', 'Infill drilling economics', 'Please send the infill drilling economics for the Casabe pads when they are ready.', MM),
  L('a11', 'contact', 'Laura Méndez <lmendez@ecopetrol.com.co>', 'Royalty sliding scale question', 'Which royalty sliding scale applies to fields above 10 kbopd after the 2026 change?', FR),
  L('a12', 'contact', 'Laura Méndez <lmendez@ecopetrol.com.co>', 'Términos fiscales 2026', 'Adjunto la nota sobre los términos fiscales y las regalías del nuevo contrato.', FR),
  L('a13', 'contact', 'Laura Méndez <lmendez@ecopetrol.com.co>', 'Call tomorrow?', 'Do you have half an hour tomorrow morning?', FR),
  L('a14', 'contact', 'Pablo Torres <ptorres@ecopetrol.com.co>', 'Fiscal terms: royalty table', 'The royalty table for the fiscal terms comparison is attached.', FR),
  L('a15', 'contact', 'Laura Méndez <lmendez@ecopetrol.com.co>', 'Draft review comments', 'My comments on the draft are in the attached file.', FR),
  L('a16', 'contact', 'Rosa Quispe <rquispe@costanortepetroleos.com.pe>', 'Talara Lote X workover schedule', 'The workover schedule for Lote X for the coming six months.', TB),
  L('a17', 'contact', 'Miguel Chávez <mchavez@costanortepetroleos.com.pe>', 'Brownfield redevelopment: capex ranges', 'Capex ranges for the Talara redevelopment cases are in the attached spreadsheet.', TB),
  L('a18', 'contact', 'Rosa Quispe <rquispe@costanortepetroleos.com.pe>', 'Reunión del jueves', 'Podemos reunirnos el jueves para revisar los avances.', TB),
  L('a19', 'contact', 'Miguel Chávez <mchavez@costanortepetroleos.com.pe>', 'Re: Talara production history', 'The monthly production history by well, as requested.', TB),
  L('a20', 'contact', 'Rosa Quispe <rquispe@costanortepetroleos.com.pe>', 'Data room access', 'Your data room access has been extended until the end of the month.', TB),
  L('a21', 'contact', 'Jorge Ruiz <jruiz@fronteraenergy.com>', 'Re: Castilla water cut', 'Water cut at Castilla is trending up faster than the type curve.', LL),
  L('a22', 'contact', 'Camila Vargas <cvargas@ecopetrol.com.co>', 'Casabe workover', 'The workover on Casabe-114 finished; production is 60 bopd higher.', MM),
  L('a23', 'contact', 'Laura Méndez <lmendez@ecopetrol.com.co>', 'Regalías: borrador', 'Le envío el borrador con el cálculo de las regalías.', FR),
  L('a24', 'contact', 'Miguel Chávez <mchavez@costanortepetroleos.com.pe>', 'Talara pressure survey', 'Pressure survey results for the Talara wells from June.', TB),

  // sent from a firm mailbox: the recipients decide
  S('b01', ['jruiz@fronteraenergy.com'], 'Re: Cubiro injection volumes for July', 'Jorge, thank you, the volumes match. We will include them in the screening.', LL),
  S('b02', ['smarin@fronteraenergy.com'], 'Waterflood screening: draft', 'Sofía, the draft screening is attached for your comments.', LL, ['jruiz@fronteraenergy.com']),
  S('b03', ['cvargas@ecopetrol.com.co'], 'Re: La Cira-Infantas infill locations', 'Camila, received. We will add the three locations to the screening.', MM),
  S('b04', ['ptorres@ecopetrol.com.co'], 'Middle Magdalena update', 'Pablo, a short update on the Middle Magdalena work is attached.', MM, ['cvargas@ecopetrol.com.co']),
  S('b05', ['lmendez@ecopetrol.com.co'], 'Re: Royalty sliding scale question', 'Laura, the 2026 change moves the threshold; details in the attached note.', FR),
  S('b06', ['lmendez@ecopetrol.com.co'], 'Fiscal terms proposal', 'Laura, our proposal on the fiscal terms is attached.', FR, ['ptorres@ecopetrol.com.co']),
  S('b07', ['rquispe@costanortepetroleos.com.pe'], 'Re: Reunión del jueves', 'Rosa, confirmado, nos vemos el jueves.', TB),
  S('b08', ['mchavez@costanortepetroleos.com.pe'], 'Talara brownfield: scope of work', 'Miguel, the scope of work for the Talara brownfield phase two is attached.', TB, ['rquispe@costanortepetroleos.com.pe']),

  // a contact of two projects: content decides, the provider breaks true ties
  L('c01', 'shared-contact', 'Pablo Torres <ptorres@ecopetrol.com.co>', 'Quick question', 'Can you send the latest presentation?', null),
  L('c02', 'shared-contact', 'Pablo Torres <ptorres@ecopetrol.com.co>', 'Presentation for Friday', 'For Friday we need the royalty sliding scale and the fiscal comparison in the deck.', FR),
  L('c03', 'shared-contact', 'Pablo Torres <ptorres@ecopetrol.com.co>', 'La Cira update', 'Casabe pressures are in; La Cira-Infantas next week.', MM),
  L('c04', 'shared-contact', 'Pablo Torres <ptorres@ecopetrol.com.co>', 'Data for next week', 'Please send the well list and pad locations for the next drilling campaign.', MM),
  L('c05', 'shared-contact', 'Pablo Torres <ptorres@ecopetrol.com.co>', 'Preguntas', '¿Podemos revisar la tabla de regalías escalonadas el lunes?', FR),
  L('c06', 'shared-contact', 'Pablo Torres <ptorres@ecopetrol.com.co>', 'FYI', 'See you Monday.', null),

  // replies in a conversation already filed to a project, from people not on any contact list
  L('d01', 'thread', 'Carlos Gil <carlos.gil@fronteraenergy.com>', 'Re: Cubiro injection volumes', 'Adding the injector allocation table.', LL, { thread: LL }),
  L('d02', 'thread', 'Sofía <sofia.marin.personal@gmail.com>', 'Re: Cubiro injection volumes', 'Sending from my phone, the July file is the right one.', LL, { thread: LL }),
  L('d03', 'thread', 'Jimena Rojas <jimena@laboratorioandino.co>', 'Re: Data', 'Sent as discussed.', TB, { thread: TB }),
  L('d04', 'thread', 'A. Pérez <a.perez@petrotech-services.com>', 'Re: Casabe infill', 'Our quote follows.', MM, { thread: MM }),
  L('d05', 'thread', 'Operations <ops@drillcorp.com>', 'Re: Talara redevelopment: contractor bids', 'Bids attached; validity 60 days.', TB, { thread: TB }),
  L('d06', 'thread', 'Andrés <andres@lawfirm-abogados.com>', 'Re: Royalty sliding scale question', 'Our view on the point is in the attachment.', FR, { thread: FR }),

  // an address at a client's domain that is not on the contact list
  L('e01', 'domain', 'Gerardo Ríos <gerardo.rios@fronteraenergy.com>', 'Cubiro waterflood: HSE induction', 'Please complete the HSE induction before the site visit.', LL),
  L('e02', 'domain', 'V. Paz <vpaz@fronteraenergy.com>', 'Timesheets', 'Please approve the timesheets for August.', LL),
  L('e03', 'domain', 'H. Salas <hsalas@costanortepetroleos.com.pe>', 'Talara redevelopment: budget approval', 'The budget for the redevelopment work is approved.', TB),
  L('e04', 'domain', 'Ecopetrol <info@ecopetrol.com.co>', 'Middle Magdalena infill screening: kickoff', 'Kick-off invitation for the infill screening.', MM),
  L('e05', 'domain', 'Finanzas <finanzas@ecopetrol.com.co>', 'Invoice payment status', 'Your invoice is in the payment run for this month.', null),
  L('e06', 'domain', 'T. Peña <tpena@fronteraenergy.com>', 'Re: Meeting', 'Works for me.', LL),

  // noise
  L('f01', 'noise', 'Oil & Gas Journal <newsletter@oilgasjournal.com>', 'This week in upstream', 'Brent closed at 84 dollars. Vaca Muerta output reached a record.', null),
  L('f02', 'noise', 'Subsea Tools <sales@subsea-tools.com>', 'Waterflood monitoring webinar', 'Join our webinar on monitoring water injection with fibre optics.', null),
  L('f03', 'noise', 'SPE <events@spe.org>', 'SPE Latin America conference: Bogotá', 'Early registration closes on Friday.', null),
  L('f04', 'noise', 'Talent Bridge <recruiter@talentbridge.com>', 'Senior reservoir engineer opening', 'We have a role that matches your profile.', null),
  L('f05', 'noise', 'Zoom <noreply@zoom.us>', 'Meeting reminder', 'Your meeting starts in one hour.', null),
  L('f06', 'noise', 'Accounts <invoices@supplier-llano.com>', 'Invoice 2026-0417', 'Please find our invoice attached.', null),
  L('f07', 'noise', 'Events <marketing@ecopetrol-events.com>', 'Ecopetrol supplier day', 'Register for the supplier day.', null),
  L('f08', 'noise', 'Bank <alerts@bank.example>', 'Statement available', 'Your monthly statement is ready.', null),

  // free mail: only an address on a contact list counts
  L('g01', 'free-mail', 'Jorge <jorge.ruiz.frontera@gmail.com>', 'Cubiro waterflood', 'I am writing from my personal address about the Cubiro waterflood.', LL),
  L('g02', 'free-mail', 'Rosa <r.quispe.talara@gmail.com>', 'Talara redevelopment', 'Adding my personal address to the thread.', TB),
  L('g03', 'free-mail', 'A friend <friend@gmail.com>', 'Lunch?', 'Are you free on Sunday?', null),
  L('g04', 'free-mail', 'Old colleague <old.colleague@hotmail.com>', 'Casabe question', 'A quick question about Casabe.', MM),

  // known limitation: a client's contact introduces a different client's work; the contact list wins and the message is filed wrongly
  L('h01', 'hard', 'Jorge Ruiz <jruiz@fronteraenergy.com>', 'Introduction: Talara redevelopment', 'Let me introduce you to Costa Norte Petróleos about the Talara redevelopment; they need help.', TB, { hard: true }),
];
