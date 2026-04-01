import json, urllib.request, time
from datetime import datetime, timedelta

token = "EAAXuBicjlngBQ18uzNL1W7lZBNxCkHkmqxTj9qzcpFJoxsa6zuZAunFFQz8XOtPVgFtvL9TMl1tuY3CfE1j10hbEvoSDRKM6EA7K1dnk8DzPf3ZCbUnzpjYZAR6eWTvgPLMY9E6RmlCkwubma2aL6YtYfgWWes8nwwbQkL35swndFPjIEyArdAoXc6K04d8AE4kjnRBhf2XhZBxOe"
acct = "act_3811336339132882"

all_charges = []
start = datetime(2024, 3, 1)
end = datetime(2026, 3, 18)

while start < end:
    chunk_end = start + timedelta(days=90)
    since_ts = int(start.timestamp())
    until_ts = int(min(chunk_end, end).timestamp())
    label = start.strftime("%Y-%m-%d")

    url = "https://graph.facebook.com/v21.0/%s/activities?fields=event_type,event_time,extra_data&limit=1000&since=%d&until=%d&access_token=%s" % (acct, since_ts, until_ts, token)

    try:
        page = 0
        while url and page < 10:
            page += 1
            with urllib.request.urlopen(url) as resp:
                data = json.loads(resp.read())

            for item in data.get("data", []):
                if item.get("event_type") == "ad_account_billing_charge":
                    try:
                        extra = json.loads(item.get("extra_data", "{}"))
                        if extra.get("transaction_id") and extra.get("new_value"):
                            all_charges.append({
                                "date": item["event_time"][:10],
                                "time": item["event_time"],
                                "amount_cents": extra["new_value"],
                                "txn": extra["transaction_id"],
                                "currency": extra.get("currency", "USD"),
                            })
                    except:
                        pass

            url = data.get("paging", {}).get("next", "")
        print("  %s: %d pages, %d charges so far" % (label, page, len(all_charges)))
    except Exception as e:
        print("  %s: ERROR %s" % (label, str(e)))

    start = chunk_end
    time.sleep(0.5)

print("\nTotal billing charges found: %d" % len(all_charges))
if all_charges:
    all_charges.sort(key=lambda x: x["date"])
    print("Earliest: %s" % all_charges[0]["date"])
    print("Latest: %s" % all_charges[-1]["date"])

    months = {}
    for c in all_charges:
        m = c["date"][:7]
        if m not in months:
            months[m] = {"count": 0, "total": 0}
        months[m]["count"] += 1
        months[m]["total"] += c["amount_cents"]

    for m in sorted(months):
        total_usd = months[m]["total"] / 100
        print("  %s: %d charges, $%s" % (m, months[m]["count"], "{:,.2f}".format(total_usd)))

with open("/tmp/fb_charges.json", "w") as f:
    json.dump(all_charges, f)
print("\nSaved to /tmp/fb_charges.json")
