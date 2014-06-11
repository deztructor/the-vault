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
    echo "vault untils are not imported"
    exit 1
fi

echo "TEST DIR: $vault"
rmdir $vault || error 899 "$vault is not empty? Need empty dir"

function test_error {
    error $(expr + $1) "$0: ERROR in line $1"
}

fname=
count=0
prefix=
module=
data=

function new_fname {
    prefix=$(printf "%03d" $count)
    fname="file$prefix"
    data="DATA:$module:$count"
    echo "New fname $fname"
    count=$(expr $count + 1)
}

function add_file_commit {
    fname=$1
    data=$2
    unit=$3
    dst=$unit/$fname
    echo "$data" > $dst || error 804 "Can't write to $dst" 
    the-vault-submodule-commit $unit "$data" || error 805 "Can't commit $unit"
}

function check_snapshots {
    cur=$(the-vault-snapshot-list | wc -l)
    if [ $cur -ne $1 ]; then
        error 111 "Wrong snapshot count: $cur, need $1"
    fi
}

the-vault-create $vault user user@test || error 901 "Can't create"
cd $vault || error 902 "Can't enter $vault"

module=Gallery
the-vault-submodule-add Gallery || error 903

new_fname
add_file_commit $fname "$data" "$module"
the-vault-snapshot-commit "$data" "$data in $module" || test_error $LINENO
check_snapshots 1

new_fname
add_file_commit $fname "$data" "$module"
the-vault-snapshot-commit "$data" "$data in $module" || test_error $LINENO
check_snapshots 2

echo "DONE"
