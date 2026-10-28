# Pricing

Pricing lives in `packages/pricing`: pure functions plus versioned JSON config
(`packages/pricing/config/v1.json`). The same code runs in the browser (live estimates) and
on the server (the authoritative price). The server never trusts a client amount; it
reprices from stored inputs.

All money is integer minor units (cents for USD). Rates are integers: material cost in
minor units per kilogram, machine rate in minor units per hour, margin and quantity
discounts in basis points (1 bp = 0.01 %). Intermediate values are kept exact (BigInt in
micro-minor units) and rounded half-up to minor units only at `discounted`.

## Formula

```
material_g    = (filament_g + support_g * 0.5) * 1.08
unit_cost     = material_g * cost_per_g[material] + (print_time_h * machine_rate_per_h) + finish_cost
unit_price    = max(min_unit_price, unit_cost * (1 + margin))
discounted    = round_half_up(unit_price * (1 - quantity_discount(qty)))
line_total    = discounted * qty + setup_fee
total         = sum(line_total) + shipping + tax - promo
```

## Config v1 (`pricing_version = 1`)

| Key | Value |
| --- | --- |
| Currency | USD |
| PLA | 2,500 ¢/kg ($0.025/g), density 1.24 g/cm³ |
| PETG | 3,000 ¢/kg ($0.030/g), density 1.27 g/cm³ |
| ASA | 3,800 ¢/kg ($0.038/g), density 1.07 g/cm³ |
| Machine rate | 300 ¢/h |
| Finish cost | 0 ¢ (standard finish only in Release 1) |
| Margin | 6,000 bp (60 %) |
| Minimum unit price | 500 ¢ |
| Setup fee | 300 ¢ per line |
| Quantity discount | 1–9: 0 bp · 10–49: 500 bp · 50–99: 1,000 bp · 100–249: 1,500 bp · 250–500: 2,000 bp |
| Shipping | standard 599 ¢, express 1,499 ¢ per order |
| Tax | 0, shown as "tax calculated where applicable" (ADR-016) |
| Quote expiry | 30 minutes |
| Reprice tolerance | 200 bp (2 %); beyond it the server returns `409 QUOTE_CHANGED` |
| Build volume | 256 × 256 × 256 mm (largest mock partner printer) |
| Scale | 1 %–1,000 % |
| Quantity | 1–500 |

Changing any value in the config means a new file (`v2.json`) and a bumped
`pricing_version`. Quotes store the version they were priced with.

## Worked examples

### 1. One PLA bracket

Inputs: PLA, filament 12 g, no supports, 1.5 h, quantity 1, standard shipping.

```
material_g  = (12 + 0) * 1.08                 = 12.96 g
material    = 12.96 g * 2.5 ¢/g                = 32.4 ¢
machine     = 1.5 h * 300 ¢/h                  = 450 ¢
unit_cost   = 32.4 + 450 + 0                   = 482.4 ¢
unit_price  = max(500, 482.4 * 1.6)            = 771.84 ¢
discounted  = round_half_up(771.84 * 1.00)     = 772 ¢
line_total  = 772 * 1 + 300                    = 1,072 ¢
total       = 1,072 + 599 shipping + 0 tax     = 1,671 ¢  ($16.71)
```

### 2. Twelve PETG enclosures with supports

Inputs: PETG, filament 40 g, supports 6 g, 4 h, quantity 12, standard shipping.

```
material_g  = (40 + 6 * 0.5) * 1.08            = 46.44 g
material    = 46.44 g * 3.0 ¢/g                = 139.32 ¢
machine     = 4 h * 300 ¢/h                    = 1,200 ¢
unit_cost   = 139.32 + 1,200                   = 1,339.32 ¢
unit_price  = max(500, 1,339.32 * 1.6)         = 2,142.912 ¢
discounted  = round_half_up(2,142.912 * 0.95)  = round_half_up(2,035.7664) = 2,036 ¢
line_total  = 2,036 * 12 + 300                 = 24,732 ¢
total       = 24,732 + 599                     = 25,331 ¢  ($253.31)
```

### 3. One hundred small ASA clips (minimum price applies)

Inputs: ASA, filament 2 g, no supports, 0.25 h, quantity 100, standard shipping.

```
material_g  = 2 * 1.08                         = 2.16 g
material    = 2.16 g * 3.8 ¢/g                 = 8.208 ¢
machine     = 0.25 h * 300 ¢/h                 = 75 ¢
unit_cost   = 83.208 ¢
unit_price  = max(500, 83.208 * 1.6 = 133.13)  = 500 ¢
discounted  = round_half_up(500 * 0.85)        = 425 ¢
line_total  = 425 * 100 + 300                  = 42,800 ¢
total       = 42,800 + 599                     = 43,399 ¢  ($433.99)
```

The minimum unit price applies before the quantity discount, as the formula orders it, so a
discounted unit can be below the minimum.

These three examples are also golden fixtures in `packages/pricing/fixtures/`.

## Print estimator (`SLICER_MODE=estimate`)

With no slicer (rule 6, ADR-002b), print time and filament mass come from a deterministic
estimator over the mesh analysis. Every quote made this way is labeled **ESTIMATE**.

```
shell_mm3     = min(volume_mm3, surface_area_mm2 * 0.8)            # ~2 perimeters at 0.4 mm
infill_mm3    = (volume_mm3 - shell_mm3) * infill_pct / 100
support_mm3   = supports == auto ? overhang_area_mm2 * (height_mm / 2) * 0.10 : 0
filament_mg   = round((shell_mm3 + infill_mm3) * density_g_cm3)     # g/cm³ == mg/mm³
support_mg    = round(support_mm3 * density_g_cm3)
flow_mm3_s    = layer_height_mm * 0.45 * 50                         # line width 0.45 mm, 50 mm/s
layers        = ceil(height_mm / layer_height_mm)
print_time_s  = round(((filament_mm3 + support_mm3) / flow_mm3_s + layers * 1.5) * 1.2)
```

Scale applies before the estimate: volume scales by s³, area by s², height by s.
