-- Demo tenant. create_demo_org() builds a fully populated organisation for
-- the calling user, based on the CORWADO UI mockups. Dates are relative to
-- today so the demo never goes stale. The data inconsistencies found in the
-- mockups are corrected here (weighted scores, GRN value, RFQ dates, vendor
-- document validity).

create or replace function _demo_req(
  p_org uuid, p_number text, p_title text, p_dept text, p_project text, p_donor text,
  p_category text, p_required_in_days integer, p_justification text, p_requester text,
  p_submitted_days_ago integer, p_level_now integer, p_status requisition_status, p_lines jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_dept uuid; v_project uuid; v_donor uuid; v_total bigint; v_sub timestamptz;
begin
  select id into v_dept from departments where org_id = p_org and name = p_dept;
  select id into v_project from projects where org_id = p_org and name = p_project;
  select id into v_donor from donors where org_id = p_org and name = p_donor;
  v_sub := now() - make_interval(days => p_submitted_days_ago, hours => 3);

  insert into requisitions (org_id, number, title, status, department_id, project_id, donor_id, budget_line_id,
                            category, required_by, justification, requester_label, submitted_at, created_at)
  values (p_org, p_number, p_title, p_status, v_dept, v_project, v_donor,
          (select id from budget_lines where org_id = p_org and department_id = v_dept
             and project_id is not distinct from v_project and donor_id = v_donor limit 1),
          p_category, current_date + p_required_in_days, p_justification, p_requester, v_sub, v_sub - interval '1 day')
  returning id into v_id;

  insert into requisition_lines (org_id, requisition_id, line_no, description, qty, unit, unit_cost_minor)
  select p_org, v_id, ord::integer, l->>0, (l->>1)::numeric, coalesce(l->>3, 'each'), (l->>2)::bigint
  from jsonb_array_elements(p_lines) with ordinality t(l, ord);

  select sum(round(qty * unit_cost_minor)) into v_total from requisition_lines where requisition_id = v_id;
  update requisitions set total_minor = v_total where id = v_id;

  insert into approval_steps (org_id, requisition_id, level, label, approver_title, note, status,
                              activated_at, acted_at, acted_by_label, comment)
  select p_org, v_id, p.level, p.label, p.approver_title, p.note,
         case when p_status = 'approved' or p.level < p_level_now then 'approved'::step_status
              when p.level = p_level_now then 'pending'::step_status else 'waiting'::step_status end,
         case when p.level <= p_level_now or p_status = 'approved' then v_sub + make_interval(days => p.level - 1) end,
         case when p_status = 'approved' or p.level < p_level_now then v_sub + make_interval(days => p.level) end,
         case when p_status = 'approved' or p.level < p_level_now then p.approver_title end,
         case when p_number = 'REQ-0142' and p.level = 1 then 'Quantities consistent with distribution plan.' end
  from route_plan(p_org, v_total, p_category, v_dept, v_project, v_donor) p;

  return v_id;
end;
$$;

create or replace function create_demo_org(p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o uuid;
  d_prg uuid; d_hlt uuid; d_log uuid; d_adm uuid; d_fin uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid;
  dn_a uuid; dn_b uuid; dn_core uuid;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  r142 uuid; r136 uuid; r128 uuid; r133 uuid;
  q31 uuid; c_price uuid; c_comp uuid; c_lead uuid; c_perf uuid; c_lic uuid;
  b_a uuid; b_b uuid; b_c uuid;
  po88 uuid; po71 uuid; po64 uuid; po91 uuid;
  l1 uuid; l2 uuid; l3 uuid; l4 uuid; l91a uuid; l91b uuid;
  g52 uuid; g53 uuid; inv uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;

  insert into orgs (name) values ('CORWADO') returning id into o;
  insert into members (org_id, user_id, display_name, title, roles)
  values (o, auth.uid(), coalesce(nullif(trim(p_display_name), ''), 'A. Procurement Officer'),
          'Procurement Officer', '{requester,approver,buyer,receiver,finance,admin}');
  perform install_default_rules(o);

  insert into departments (org_id, name, head_title) values
    (o, 'Programs', 'Head of Programs') returning id into d_prg;
  insert into departments (org_id, name, head_title) values (o, 'Health', 'Head of Health') returning id into d_hlt;
  insert into departments (org_id, name, head_title) values (o, 'Logistics', 'Head of Logistics') returning id into d_log;
  insert into departments (org_id, name, head_title) values (o, 'Administration', 'Head of Administration') returning id into d_adm;
  insert into departments (org_id, name, head_title) values (o, 'Finance', 'Head of Finance') returning id into d_fin;

  insert into projects (org_id, name, manager_title) values (o, 'Project 01', 'Project 01 Manager') returning id into p1;
  insert into projects (org_id, name, manager_title) values (o, 'Project 02', 'Project 02 Manager') returning id into p2;
  insert into projects (org_id, name, manager_title) values (o, 'Project 03', 'Project 03 Manager') returning id into p3;
  insert into projects (org_id, name, manager_title) values (o, 'Project 04', 'Project 04 Manager') returning id into p4;

  insert into donors (org_id, name) values (o, 'Donor A') returning id into dn_a;
  insert into donors (org_id, name) values (o, 'Donor B') returning id into dn_b;
  insert into donors (org_id, name) values (o, 'Core funds') returning id into dn_core;

  -- Budget lines. Committed totals reproduce the dashboard (USD 412,300 by
  -- department) and the Donor A Q3 summary (USD 308,300 by project).
  insert into budget_lines (org_id, code, department_id, project_id, donor_id, amount_minor, committed_minor, spent_minor) values
    (o, 'ADM-01-4200', d_adm, p1, dn_a,     4000000,  1200000,  900000),
    (o, 'PRG-01-1100', d_prg, p1, dn_a,    12000000,  8440000, 7220000),
    (o, 'HLT-02-3100', d_hlt, p2, dn_a,    12000000,  7880000, 6000000),
    (o, 'PRG-02-1200', d_prg, p2, dn_a,    10000000,  6990000, 4995000),
    (o, 'HLT-03-3200', d_hlt, p3, dn_a,     5000000,  3000000, 2500000),
    (o, 'LOG-03-5100', d_log, p3, dn_a,     2500000,  1520000, 1300000),
    (o, 'PRG-04-1300', d_prg, p4, dn_a,     3000000,  1800000, 1200000),
    (o, 'PRG-03-1400', d_prg, p3, dn_b,     3000000,  1410000,  900000),
    (o, 'HLT-04-3300', d_hlt, p4, dn_b,     2500000,  1310000,  800000),
    (o, 'LOG-00-5000', d_log, null, dn_core, 8000000, 4300000, 3000000),
    (o, 'ADM-00-4000', d_adm, null, dn_core, 4000000, 1770000, 1200000),
    (o, 'FIN-00-6000', d_fin, null, dn_core, 3000000, 1610000, 1000000),
    (o, 'PRG-01-1500', d_prg, p1, dn_b,     2000000,        0,       0);

  -- Vendors
  insert into vendors (org_id, number, legal_name, trading_name, status, categories, registration_no, tax_id,
                       contact, email, bank, conflict_of_interest, registered_on,
                       score_price, score_quality, score_delivery, score_responsiveness, score_compliance, on_time_pct)
  values (o, 'VND-0017', 'Vendor A Limited', 'Vendor A Ltd', 'approved', 'Medical supplies, office supplies',
          'RC-00481223', 'TIN-3382-1190', 'Sales Manager, +000 000 0000', 'sales@vendor-a.example',
          'Bank A, account ending 4471', 'Declared, none', current_date - 560, 4.1, 4.5, 4.2, 4.6, 4.0, 92)
  returning id into v_a;
  insert into vendors (org_id, number, legal_name, trading_name, status, categories, registration_no, tax_id,
                       contact, email, bank, conflict_of_interest, registered_on,
                       score_price, score_quality, score_delivery, score_responsiveness, score_compliance, on_time_pct)
  values (o, 'VND-0021', 'Vendor B Supplies Limited', 'Vendor B Supplies', 'approved', 'Medical supplies, stationery',
          'RC-00512877', 'TIN-4410-2087', 'Account Manager, +000 000 0001', 'orders@vendor-b.example',
          'Bank B, account ending 0932', 'Declared, none', current_date - 400, 4.4, 3.6, 3.7, 4.0, 3.8, 81)
  returning id into v_b;
  insert into vendors (org_id, number, legal_name, trading_name, status, categories, registration_no, tax_id,
                       contact, email, bank, conflict_of_interest, registered_on)
  values (o, 'VND-0024', 'Vendor C Trading Limited', 'Vendor C Trading', 'approved', 'Medical supplies',
          'RC-00599310', 'TIN-5120-3344', 'Director, +000 000 0002', 'tenders@vendor-c.example',
          'Bank A, account ending 2210', 'Declared, none', current_date - 60)
  returning id into v_c;
  insert into vendors (org_id, number, legal_name, trading_name, status, categories, registration_no, tax_id,
                       contact, email, bank, conflict_of_interest, registered_on)
  values (o, 'VND-0026', 'Vendor D Medical Limited', 'Vendor D Medical', 'approved', 'Medical supplies, diagnostics',
          'RC-00601554', 'TIN-5502-7781', 'Sales, +000 000 0003', 'sales@vendor-d.example',
          'Bank C, account ending 8120', 'Declared, none', current_date - 30)
  returning id into v_d;

  insert into vendor_documents (org_id, vendor_id, name, expires_on) values
    (o, v_a, 'Certificate of incorporation', null),
    (o, v_a, 'Tax clearance certificate', current_date + 100),
    (o, v_a, 'Pharmacy board licence', current_date + 8),
    (o, v_a, 'Bank confirmation letter', null),
    (o, v_a, 'Insurance certificate', current_date + 140),
    (o, v_b, 'Certificate of incorporation', null),
    (o, v_b, 'Tax clearance certificate', current_date - 10),
    (o, v_b, 'Pharmacy board licence', current_date + 200),
    (o, v_c, 'Certificate of incorporation', null),
    (o, v_c, 'Tax clearance certificate', current_date + 300),
    (o, v_c, 'Pharmacy board licence', current_date + 250),
    (o, v_d, 'Certificate of incorporation', null),
    (o, v_d, 'Tax clearance certificate', current_date + 25);

  -- Requisitions (approval queue, oldest first)
  r142 := _demo_req(o, 'REQ-0142', 'Medical consumables, Q4', 'Health', 'Project 02', 'Donor A', 'Medical supplies', 54,
    'Quarterly replenishment of consumables for four health posts, based on consumption data for the previous two quarters and the approved distribution plan.',
    'Health Program Officer', 6, 2, 'submitted',
    '[["Examination gloves, nitrile, box of 100",400,950],["Surgical masks, box of 50",600,400],["Antiseptic solution, 5 L",120,1800],["Rapid diagnostic test kits, box of 25",160,6275]]');
  perform _demo_req(o, 'REQ-0139', 'Vehicle servicing, 3 units', 'Logistics', null, 'Core funds', 'Services', 20,
    'Scheduled servicing for three field vehicles.', 'Fleet Officer', 5, 1, 'submitted',
    '[["Full service, 4x4 vehicle",2,100000,"vehicle"],["Full service, minibus",1,95000,"vehicle"]]');
  perform _demo_req(o, 'REQ-0137', 'Training venue and catering', 'Programs', 'Project 03', 'Donor B', 'Services', 30,
    'Three-day community health worker training for 40 participants.', 'Programs Officer', 4, 2, 'submitted',
    '[["Venue hire, 3 days",3,60000,"day"],["Catering, 40 participants x 3 days",120,2000,"person-day"]]');
  perform _demo_req(o, 'REQ-0135', 'Laptops for new staff', 'Administration', null, 'Core funds', 'Goods', 25,
    'Four laptops for new finance and programme staff.', 'Office Manager', 2, 1, 'submitted',
    '[["Laptop, 14 inch, 16 GB RAM",4,190000]]');
  r133 := _demo_req(o, 'REQ-0133', 'Water tanks, community sites', 'Programs', 'Project 01', 'Donor A', 'Goods', 45,
    'Water storage for six community sites under the WASH component.', 'WASH Officer', 1, 3, 'submitted',
    '[["Water tank, 5,000 L, polyethylene",8,250000],["Tank stand, steel",8,25000]]');
  perform _demo_req(o, 'REQ-0131', 'Printing of IEC materials', 'Programs', 'Project 01', 'Donor B', 'Goods', 15,
    'Information, education and communication leaflets for the hygiene campaign.', 'Communications Officer', 1, 1, 'submitted',
    '[["Leaflet, A5, full colour",4000,25],["Poster, A2, full colour",100,180]]');

  -- Approved requisitions that fed sourcing and purchasing
  r136 := _demo_req(o, 'REQ-0136', 'Medical consumables, Q4, central warehouse', 'Health', 'Project 02', 'Donor A', 'Medical supplies', 40,
    'Central warehouse buffer stock for Q4.', 'Health Program Officer', 30, 3, 'approved',
    '[["Examination gloves, nitrile, box of 100",400,950],["Surgical masks, box of 50",600,400],["Antiseptic solution, 5 L",120,1800],["Rapid diagnostic test kits, box of 25",160,6275]]');
  r128 := _demo_req(o, 'REQ-0128', 'Medical consumables, Q3', 'Health', 'Project 02', 'Donor A', 'Medical supplies', -30,
    'Quarterly replenishment, Q3.', 'Health Program Officer', 50, 3, 'approved',
    '[["Examination gloves, nitrile, box of 100",400,950],["Surgical masks, box of 50",600,400],["Antiseptic solution, 5 L",120,1800],["Rapid diagnostic test kits, box of 25",160,6275]]');

  insert into attachments (org_id, record_type, record_id, name, size_bytes) values
    (o, 'requisition', r142, 'Distribution plan Q4.xlsx', 48211),
    (o, 'requisition', r142, 'Consumption report.pdf', 312004),
    (o, 'requisition', r142, 'Donor A budget extract.pdf', 96120);

  -- RFQ-0031 (closed, under evaluation)
  insert into rfqs (org_id, number, requisition_id, title, status, closes_at, delivery_location, terms)
  values (o, 'RFQ-0031', r136, 'Medical consumables, Q4', 'evaluation',
          date_trunc('day', now()) - interval '2 days' + interval '17 hours', 'Central warehouse',
          'Items as per attached specification sheet. Quote unit prices inclusive of delivery. Validity of quotation 60 days. Payment within 30 days of accepted delivery.')
  returning id into q31;
  insert into rfq_criteria (org_id, rfq_id, position, name, type, weight, is_price) values
    (o, q31, 1, 'Total price', 'Financial', 40, true) returning id into c_price;
  insert into rfq_criteria (org_id, rfq_id, position, name, type, weight) values
    (o, q31, 2, 'Compliance with specifications', 'Technical', 25) returning id into c_comp;
  insert into rfq_criteria (org_id, rfq_id, position, name, type, weight) values
    (o, q31, 3, 'Delivery lead time', 'Technical', 15) returning id into c_lead;
  insert into rfq_criteria (org_id, rfq_id, position, name, type, weight) values
    (o, q31, 4, 'Vendor past performance', 'Non-financial', 10) returning id into c_perf;
  insert into rfq_criteria (org_id, rfq_id, position, name, type, weight) values
    (o, q31, 5, 'Validity of licences and documents', 'Compliance', 10) returning id into c_lic;

  insert into rfq_invites (org_id, rfq_id, vendor_id, invited_at, status) values
    (o, q31, v_a, now() - interval '14 days', 'Bid received'),
    (o, q31, v_b, now() - interval '14 days', 'Bid received'),
    (o, q31, v_c, now() - interval '14 days', 'Bid received'),
    (o, q31, v_d, now() - interval '13 days', 'Acknowledged');

  insert into bids (org_id, rfq_id, vendor_id, total_minor, validity_days, submitted_at)
  values (o, q31, v_a, 1795000, 60, now() - interval '4 days') returning id into b_a;
  insert into bids (org_id, rfq_id, vendor_id, total_minor, validity_days, submitted_at)
  values (o, q31, v_b, 1723000, 30, now() - interval '3 days') returning id into b_b;
  insert into bids (org_id, rfq_id, vendor_id, total_minor, validity_days, submitted_at)
  values (o, q31, v_c, 1940000, 90, now() - interval '3 days') returning id into b_c;

  insert into bid_scores (org_id, bid_id, criterion_id, score, note) values
    (o, b_a, c_comp, 25, 'Full'), (o, b_a, c_lead, 14, '10 days'), (o, b_a, c_perf, 8.6, '4.3 / 5'), (o, b_a, c_lic, 10, 'Valid'),
    (o, b_b, c_comp, 18, 'Partial'), (o, b_b, c_lead, 9, '21 days'), (o, b_b, c_perf, 7.8, '3.9 / 5'), (o, b_b, c_lic, 4.2, 'Tax clearance expired'),
    (o, b_c, c_comp, 25, 'Full'), (o, b_c, c_lead, 12, '14 days'), (o, b_c, c_perf, 5, 'No history'), (o, b_c, c_lic, 10, 'Valid');

  insert into evaluators (org_id, rfq_id, title, submitted) values
    (o, q31, 'Procurement Officer', true), (o, q31, 'Health Technical Lead', true), (o, q31, 'Finance Officer', false);

  insert into clarifications (org_id, rfq_id, vendor_id, question, answer, asked_at) values
    (o, q31, v_b, 'Can gloves be quoted in cartons of 10 boxes instead of single boxes?',
     'Yes, provided the unit price per box is stated. Answer shared with all invited vendors.', now() - interval '10 days'),
    (o, q31, v_d, 'Is partial delivery acceptable for the test kits?', null, now() - interval '9 days');

  -- Purchase orders
  insert into purchase_orders (org_id, number, vendor_id, requisition_id, title, status, version, po_date,
                               expected_delivery, delivery_location, budget_line_id, tax_label, status_dates)
  values (o, 'PO-0088', v_a, r128, 'Medical consumables, Q3', 'partially_received', 2, current_date - 41,
          current_date - 3, 'Central warehouse',
          (select id from budget_lines where org_id = o and code = 'HLT-02-3100'), 'Tax, exempt (donor-funded)',
          jsonb_build_object('draft', current_date - 43, 'approved', current_date - 41, 'issued', current_date - 41,
                             'partially_received', current_date - 3))
  returning id into po88;
  insert into po_lines (org_id, po_id, line_no, description, short_name, qty, unit_price_minor)
  values (o, po88, 1, 'Examination gloves, nitrile, box of 100', 'Examination gloves, nitrile', 400, 920) returning id into l1;
  insert into po_lines (org_id, po_id, line_no, description, short_name, qty, unit_price_minor)
  values (o, po88, 2, 'Surgical masks, box of 50', 'Surgical masks', 600, 390) returning id into l2;
  insert into po_lines (org_id, po_id, line_no, description, short_name, qty, unit_price_minor)
  values (o, po88, 3, 'Antiseptic solution, 5 L', 'Antiseptic solution, 5 L', 120, 1775) returning id into l3;
  insert into po_lines (org_id, po_id, line_no, description, short_name, qty, unit_price_minor)
  values (o, po88, 4, 'Rapid diagnostic test kits, box of 25', 'Rapid diagnostic test kits', 160, 6125) returning id into l4;
  insert into po_versions (org_id, po_id, version, change, by_label, approved_by, approved_on) values
    (o, po88, 1, 'Original purchase order issued.', 'Procurement Officer', 'Head of Operations', current_date - 41),
    (o, po88, 2, 'Delivery date moved forward 14 days at vendor request. Values unchanged.', 'Procurement Officer', 'Head of Operations', current_date - 25);

  insert into purchase_orders (org_id, number, vendor_id, title, status, po_date, expected_delivery, delivery_location, status_dates)
  values (o, 'PO-0071', v_a, 'Examination gloves', 'closed', current_date - 120, current_date - 100, 'Central warehouse',
          jsonb_build_object('closed', current_date - 80)) returning id into po71;
  insert into po_lines (org_id, po_id, line_no, description, short_name, qty, unit_price_minor)
  values (o, po71, 1, 'Examination gloves, nitrile, box of 100', 'Examination gloves', 400, 950);
  insert into purchase_orders (org_id, number, vendor_id, title, status, po_date, expected_delivery, delivery_location, status_dates)
  values (o, 'PO-0064', v_a, 'Office stationery', 'closed', current_date - 160, current_date - 150, 'Head office',
          jsonb_build_object('closed', current_date - 130)) returning id into po64;
  insert into po_lines (org_id, po_id, line_no, description, short_name, qty, unit_price_minor)
  values (o, po64, 1, 'Office stationery bundle', 'Office stationery', 1, 124000);

  insert into purchase_orders (org_id, number, vendor_id, title, status, po_date, expected_delivery, delivery_location, status_dates)
  values (o, 'PO-0091', v_b, 'Office stationery, Q4', 'issued', current_date - 9, current_date, 'Head office',
          jsonb_build_object('draft', current_date - 11, 'approved', current_date - 9, 'issued', current_date - 9))
  returning id into po91;
  insert into po_lines (org_id, po_id, line_no, description, short_name, qty, unit_price_minor)
  values (o, po91, 1, 'Paper, A4, 80 gsm, ream', 'Paper, A4', 200, 450) returning id into l91a;
  insert into po_lines (org_id, po_id, line_no, description, short_name, qty, unit_price_minor)
  values (o, po91, 2, 'Toner cartridge, black', 'Toner cartridge', 12, 6500) returning id into l91b;

  -- GRN-0052: accepted partial receipt against PO-0088
  insert into goods_receipts (org_id, number, po_id, status, delivered_on, location, checklist,
                              discrepancy_item, discrepancy_type, discrepancy_note, accepted_at)
  values (o, 'GRN-0052', po88, 'accepted', current_date - 3, 'Central warehouse',
          '{"Correct items delivered":true,"Correct quantities delivered":false,"Items meet specifications":true,"Goods undamaged":true,"Batch or serial numbers recorded":true,"Delivery documents provided":true}',
          'Antiseptic solution, 5 L', 'Short delivery',
          '100 of 120 units delivered. Vendor delivery note states 120. Vendor contacted, balance promised within 5 working days.',
          now() - interval '3 days')
  returning id into g52;
  insert into grn_lines (org_id, grn_id, po_line_id, received_qty, inspection) values
    (o, g52, l1, 400, 'Passed'), (o, g52, l2, 600, 'Passed'),
    (o, g52, l3, 100, 'Short delivery'), (o, g52, l4, 0, 'Not delivered');
  insert into attachments (org_id, record_type, record_id, name, size_bytes) values
    (o, 'goods_receipt', g52, 'Vendor delivery note DN-4471.pdf', 182300);

  -- GRN-0053: draft, ready for the demo user to receive and sign
  insert into goods_receipts (org_id, number, po_id, status, delivered_on, location)
  values (o, 'GRN-0053', po91, 'draft', current_date, 'Head office') returning id into g53;
  insert into grn_lines (org_id, grn_id, po_line_id, received_qty, inspection) values
    (o, g53, l91a, 200, 'Passed'), (o, g53, l91b, 12, 'Passed');

  -- INV-2207: three-way match exception
  insert into invoices (org_id, number, vendor_ref, po_id, status, invoice_date, received_on)
  values (o, 'INV-2207', 'VA-2026-118', po88, 'exception', current_date - 1, current_date) returning id into inv;
  insert into invoice_lines (org_id, invoice_id, po_line_id, qty, unit_price_minor) values
    (o, inv, l1, 400, 920), (o, inv, l2, 600, 390), (o, inv, l3, 120, 1775), (o, inv, l4, 160, 6125);

  insert into doc_counters (org_id, doc_type, next_val) values
    (o, 'REQ', 143), (o, 'RFQ', 32), (o, 'PO', 92), (o, 'GRN', 54), (o, 'INV', 2208), (o, 'VND', 27);

  -- Backdated history
  insert into audit_events (org_id, at, actor_label, action, record_type, record_id, record_label, detail) values
    (o, now() - interval '43 days', 'System Administrator', 'Permission changed', 'member', null, 'User: Receiving Officer',
     'Role Receiver granted. Approver role removed to enforce segregation of duties.'),
    (o, now() - interval '41 days', 'Head of Operations', 'Approved', 'purchase_order', po88, 'PO-0088', 'Original purchase order issued.'),
    (o, now() - interval '26 days', 'Procurement Officer', 'Document uploaded', 'vendor', v_a, 'VND-0017',
     'Tax clearance certificate, valid to ' || to_char(current_date + 100, 'DD Mon YYYY') || '.'),
    (o, now() - interval '25 days', 'Head of Operations', 'Amendment approved', 'purchase_order', po88, 'PO-0088',
     'Version 2 issued. Delivery date changed to ' || to_char(current_date - 3, 'DD Mon YYYY') || '.'),
    (o, now() - interval '14 days', 'Procurement Officer', 'Vendors invited', 'rfq', q31, 'RFQ-0031',
     'Vendor A Ltd, Vendor B Supplies, Vendor C Trading, Vendor D Medical.'),
    (o, now() - interval '10 days', 'Procurement Officer', 'Clarification answered', 'rfq', q31, 'RFQ-0031',
     'Response to Vendor B Supplies shared with all invited vendors.'),
    (o, now() - interval '6 days 3 hours', 'Health Program Officer', 'Submitted', 'requisition', r142, 'REQ-0142',
     '4 line items, 3 attachments, estimated USD 18,400.00.'),
    (o, now() - interval '5 days 3 hours', 'Head of Health', 'Approved', 'requisition', r142, 'REQ-0142',
     'Level 1 of 3. Comment: quantities consistent with distribution plan.'),
    (o, now() - interval '30 hours', 'System', 'Reminder sent', 'vendor', v_a, 'VND-0017',
     'Pharmacy board licence expires in 9 days.'),
    (o, now() - interval '3 days', 'Receiving Officer', 'Goods received', 'goods_receipt', g52, 'GRN-0052',
     'Partial receipt against PO-0088. Short delivery recorded on line 3.'),
    (o, now() - interval '2 hours', 'Finance Officer', 'Invoice registered', 'invoice', inv, 'INV-2207',
     'Vendor A Ltd, USD 17,950.00. Matching run: 2 exceptions.');

  return o;
end;
$$;

revoke execute on function _demo_req from anon, public, authenticated;
revoke execute on function create_demo_org from anon, public;
grant execute on function create_demo_org to authenticated;
