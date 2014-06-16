#!/bin/bash

if [ $# -ne 1 ]; then
    echo "Usage: $0 tmpdir_vault_dir_name"
    exit 1
fi
vault=$1

cdir=`dirname $0`
cdir=`cd $cdir;pwd`
src=`cd $cdir/../src;pwd`

source $src/the-vault_misc $src
if [ "x$vault_misc" == "x" ]; then
    echo "vault utils are not imported"
    exit 1
fi

echo "TEST DIR: $vault"
rmdir $vault || error 99 "$vault is not empty? Need empty dir"

function on_exit {
    echo "REMOVE: $vault"
}
trap on_exit EXIT

function test_error {
    error 222 "LINE $1"
}

fname=
count=0
prefix=
module=
data=

function gen_data {
    local module=$1 count=$2
    echo "DATA:$module:$count"
}

function new_fname {
    prefix=$(printf "%03d" $count)
    fname="file$prefix"
    data=$(gen_data $module $count)
    echo "New fname $fname"
    count=$(expr $count + 1)
}

function add_file_commit {
    local fname=$1 data=$2 unit=$3
    local dst=$unit/$fname
    echo "Write $data to the `pwd`/$dst"
    cat $dst
    echo "$data" > $dst || error 84 "Can't write to $dst" 
    cat $dst
    the-vault-submodule-commit $unit "$data" || error 85 "Can't commit $unit"
}

function check_snapshots {
    cur=$(the-vault-snapshot-list | wc -l)
    if [ $cur -ne $1 ]; then
        error 111 "Wrong snapshot count: $cur, need $1"
    fi
}

snapshots_count=0
function new_snapshot {
    echo "New snapshot for $module"
    the-vault-snapshot-commit "$data" "$data in $module" || test_error $1
    snapshots_count=$(expr $snapshots_count + 1)
    check_snapshots $snapshots_count
}

function check_file {
    local name=$1
    local data=$2
}

the-vault-create $vault user user@test || error 901 "Can't create"
cd $vault || error 902 "Can't enter $vault"

module=Gallery
the-vault-submodule-add $module || error 93

new_fname
add_file_commit $fname "$data" "$module"
new_snapshot $LINENO
snapshot1=$(the-vault-snapshot-list | head -n 1)

new_fname
add_file_commit $fname "$data" "$module"
new_snapshot $LINENO

module=People
the-vault-submodule-add $module 0 || error 93

new_fname
add_file_commit $fname "$data" "$module"
new_snapshot $LINENO

new_fname
add_file_commit $fname "$data" "$module"
new_snapshot $LINENO

module=Gallery
new_fname
add_file_commit $fname "$data" "$module"
new_snapshot $LINENO

add_file_commit file000 "$data" "$module"
new_snapshot $LINENO

snapshotN=$(the-vault-snapshot-list | tail -n 1)

the-vault-snapshot-revert $snapshot1 || error 43 "Can't revert to $snapshot1"

the-vault-snapshot-revert $snapshotN || error 43 "Can't revert to $snapshot1"
echo "DONE"
