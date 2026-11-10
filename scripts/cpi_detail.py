"""US CPI by category (BLS CPI-U item indexes). m/m from seasonally adjusted (CUSR0000), 12-month from not adjusted (CUUR0000), as BLS reports them.
Group tags let the desk show the internals: aggregates, food, energy, core goods, core services."""
CPI_ITEMS = [
    # (item code, label, group)
    ("SA0", "All items", "agg"), ("SA0L1E", "Core (ex food & energy)", "agg"), ("SAF1", "Food", "agg"), ("SA0E", "Energy", "agg"),
    ("SACL1E", "Core goods", "agg"), ("SASLE", "Core services", "agg"),
    ("SAF11", "Food at home", "food"), ("SEFV", "Food away from home", "food"), ("SAF111", "Cereals & bakery products", "food"),
    ("SEFA", "Cereals & cereal products", "food"), ("SEFB", "Bakery products", "food"), ("SAF112", "Meats, poultry, fish & eggs", "food"),
    ("SEFC", "Beef & veal", "food"), ("SEFF", "Chicken", "food"), ("SEFH", "Eggs", "food"), ("SEFJ", "Dairy products", "food"),
    ("SAF113", "Fruits & vegetables", "food"), ("SEFK", "Fresh fruits", "food"), ("SEFL", "Fresh vegetables", "food"),
    ("SEFL02", "Lettuce", "food"), ("SEFL03", "Tomatoes", "food"), ("SAF114", "Nonalcoholic beverages", "food"), ("SEFP01", "Coffee", "food"),
    ("SEFR", "Sugar & sweets", "food"), ("SEFS", "Fats & oils", "food"), ("SAF116", "Alcoholic beverages", "food"),
    ("SETB01", "Gasoline", "energy"), ("SEHE01", "Fuel oil", "energy"), ("SEHF01", "Electricity", "energy"), ("SEHF02", "Utility (piped) gas", "energy"),
    ("SETA01", "New vehicles", "goods"), ("SETA02", "Used cars & trucks", "goods"), ("SAA", "Apparel", "goods"),
    ("SAM1", "Medical care commodities", "goods"), ("SAH3", "Household furnishings & operations", "goods"), ("SERA01", "Televisions", "goods"),
    ("SEGA", "Tobacco & smoking products", "goods"),
    ("SAH1", "Shelter", "services"), ("SEHA", "Rent of primary residence", "services"), ("SEHC", "Owners' equivalent rent", "services"),
    ("SEHB", "Lodging away from home", "services"), ("SAM2", "Medical care services", "services"), ("SEMD", "Hospital services", "services"),
    ("SEMC01", "Physicians' services", "services"), ("SETE", "Motor vehicle insurance", "services"), ("SETD", "Motor vehicle maintenance & repair", "services"),
    ("SETG01", "Airline fares", "services"), ("SAS4", "Transportation services", "services"), ("SEHG", "Water, sewer & trash", "services"),
    ("SAE", "Education & communication", "services"), ("SAR", "Recreation", "services"),
]
