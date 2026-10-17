"""Every number the backtest uses, as (low, most_likely, high) ranges with where it came from.

Most public benchmarks here are vendor-published, so ranges are deliberately wide.
"assumption" means no usable public number was found - those are the first things
to replace with your own call-log data (`python -m backtest --calibrate ...`).
"""

R = tuple  # (low, mode, high) for a triangular draw

FOUNDER = {
    # Weekdays until class at 5:30pm plus Saturdays; productive phone time, not clock time.
    "hours_per_week": (R((25, 35, 45)), "your schedule: free daytime M-F + weekends"),
    "ramp_weeks": (2, "assumption: first 2 weeks at reduced conversion while learning the script"),
    "ramp_penalty": (R((0.5, 0.65, 0.8)), "assumption"),
    "caller_wage": (7.0, "offshore setter ~$5-6+/hr (hiretalent.ph) + platform fees"),
    "max_dial_hours": (R((15, 20, 25)), "assumption: sustained cold-calling ceiling (~3-5 hrs/day); the rest goes to meetings and admin"),
    "meeting_hours": (1.0, "assumption: prep + 30-min call + follow-up per sales meeting"),
}

# Selling to contractors by cold call (ideas 1 and 2 share this funnel).
SALES_FUNNEL = {
    "dials_per_hour": (R((20, 28, 35)), "assumption: manual dialing incl. voicemails and logging"),
    "connect_rate": (R((0.04, 0.07, 0.12)),
                     "conversation with the decision maker per dial. Belkins: 9.9% connect x 58% reach a conversation = 5.7%; "
                     "owner-run trades shops answer their own phones more often"),
    "show_rate": (R((0.60, 0.70, 0.80)), "CareerBuilder setter listing models 75% show rate"),
}

REVIVAL = {
    "conv_to_meeting": (R((0.06, 0.12, 0.20)),
                        "Belkins 4.6% conversation->meeting for generic B2B; zero-risk performance offer should beat that (assumption)"),
    "meeting_to_close": (R((0.20, 0.33, 0.50)), "assumption: no-cost offer, main objection is handing a stranger their customer list"),
    "onboarding_hours": (2.0, "assumption: export the list, approve the script"),
    "has_usable_list": (R((0.45, 0.60, 0.80)), "assumption: many small shops lack exportable estimate history"),
    "list_size": (R((60, 180, 400)), "assumption: callable unsold estimates per contractor"),
    "new_estimates_per_month": (R((10, 25, 50)), "assumption: fresh unsold quotes each month after the backlog"),
    "homeowner_dials_per_hour": (R((25, 30, 40)), "assumption"),
    "attempts_per_lead": (2.5, "assumption: up to 3 tries, avg 2.5"),
    "reach_rate": (R((0.35, 0.50, 0.65)), "assumption: share of homeowners reached within 3 tries"),
    "book_per_reached": (R((0.06, 0.12, 0.20)),
                         "Chiirp 20-30% / ServiceTitan 15-20% recovery are for fresh estimates; old lists convert lower"),
    "visit_to_close": (R((0.25, 0.35, 0.45)), "HVAC replacement close rate 32-43% (ACHR News via ustechautomations)"),
    "ticket": (R((800, 4000, 12000)), "sample mix of repair and replacement estimates"),
    "fee_rate": (0.10, "the offer"),
    "pay_delay_weeks": (R((2, 4, 7)), "assumption: book -> install -> invoice -> paid"),
    "non_payment": (R((0.05, 0.10, 0.20)), "assumption: disputes over attribution"),
    "monthly_retention": (R((0.65, 0.75, 0.85)), "assumption: clients kept on for new estimates after backlog"),
    "tools_per_month": (30.0, "phone line + sheets"),
}

MISSED_CALL = {
    "conv_to_meeting": (R((0.05, 0.09, 0.14)), "assumption: paid offer, slightly below revival"),
    "meeting_to_close": (R((0.20, 0.33, 0.45)), "assumption: $99 off-the-shelf tools (Jobber, Goodcall) compete"),
    "price": (297.0, "the offer; market $49-$500 (Pipelineon, TRTC)"),
    "setup_fee": (250.0, "the offer"),
    "setup_fee_collected": (R((0.3, 0.5, 0.7)), "assumption: often waived to close"),
    "cost_per_client": (R((30, 50, 90)), "Twilio number + SMS + A2P 10DLC + hosting, plus optional AI (assumption)"),
    "onboarding_hours": (R((3, 4, 6)), "assumption"),
    "support_hours_per_month": (R((0.5, 1.0, 2.0)), "assumption"),
    "monthly_churn": (R((0.04, 0.07, 0.12)), "assumption: SMB SaaS-like churn"),
}

SETTER = {
    "weeks_to_get_placed": (R((1, 2, 4)), "assumption: time to land a commission gig"),
    "dials_per_hour": (R((15, 20, 30)), "assumption: warm leads mean longer calls"),
    "connect_rate": (R((0.10, 0.18, 0.30)),
                     "assumption: high-ticket setter roles usually work warm/inbound leads the offer owner supplies, "
                     "well above cold B2B (GrowthSpree 4.8%, Belkins 9.9%)"),
    "conv_to_set": (R((0.08, 0.14, 0.22)), "assumption for warm leads; cold B2B is 4.6% (Belkins), top teams 11.3% (Cognism)"),
    "show_rate": (R((0.60, 0.70, 0.80)), "CareerBuilder listing: 75%"),
    "close_rate": (R((0.12, 0.18, 0.25)), "CareerBuilder listing: 15-20% close ratio"),
    "ticket": (R((1500, 3000, 6000)), "CREATE MEDIA listing: $3k+ average ticket"),
    "commission": (R((0.08, 0.12, 0.15)), "10-15% per close (Salesfolks, CREATE MEDIA)"),
    "show_bonus": (15.0, "CREATE MEDIA: $15-20 per qualified show"),
    "pay_delay_weeks": (R((2, 3, 4)), "assumption"),
    "gig_loss_per_week": (0.03, "assumption: client offer dies or stops paying"),
    "admin_share": (0.15, "assumption: CRM updates, Slack, training"),
}

COMBO = {
    "upsell_rate": (R((0.15, 0.30, 0.45)),
                    "assumption: share of revival clients who add Missed-Call Rescue once you've brought them jobs"),
}

SOURCES = {
    "Belkins": "https://belkins.io/blog/cold-calling-benchmarks",
    "GrowthSpree": "https://www.growthspreeofficial.com/blogs/b2b-saas-cold-call-connect-rate-benchmarks-2026-dial-attempts-conversation-rate-meeting-conversion",
    "CareerBuilder": "https://www.careerbuilder.com/job-details/appointment-setter-sdr-houston-tx--b0950906-5feb-4b51-aa1c-43faa0052213",
    "CREATE MEDIA": "https://cazvid.com/job/remote-appointment-setter-pune-united-states-53dcca",
    "Salesfolks": "https://salesfolks.com/job/appointment-setter-remote-1099-commission-only",
    "hiretalent.ph": "https://hiretalent.ph/filipino-appointment-setter-salary/",
    "Chiirp": "https://chiirp.com/insider_information_blog/estimate-rehash-playbook",
    "ServiceTitan via Pipelineon": "https://pipelineon.com/blog/why-leads-not-converting/",
    "ustechautomations": "https://ustechautomations.com/resources/blog/automate-stop-unsold-estimates-going-cold-in-home-services-2026",
    "Pipelineon": "https://pipelineon.com/blog/ai-receptionist-contractor/",
    "TRTC": "https://trtc.io/blog/details/ai-receptionist-cost-pricing-guide",
}
