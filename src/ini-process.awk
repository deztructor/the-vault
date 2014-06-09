BEGIN {
    if (section == "" && key == "") {
        print "Need section and key" > "/dev/stderr"
        exit(1)
    }
    section="[" section "]"
    key_re=key " *=.*"
    found=0
    ok=0
}

function print_kv(k, v) {
    print "\t" k " = " v
    ok = 1
 }

$0 ~ /\[\w+\]/ {
    if (found) {
        if (!ok)
            print_kv(key, value)
    } else {
        found = ($0 == section);
    }
}

$0 ~ key_re && op == "set" {
    if (found) {
        print "\t" key " = " value
        ok = 1
    }
}

$0 ~ key_re && op != "set" {
    if (found) {
        print gensub(/\s*\w+ *= *(.+)/, "\\1", $0)
        ok=1
    }
}

op == "set" && ($0 !~ key_re) {
    print $0
}

END {
    if (!ok) {
        if (op != "set") {
            print "No key found" > "/dev/stderr"
            exit(1)
        } else {
            print section
            print_kv(key, value)
        }
    }
}

