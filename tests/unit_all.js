#!/usr/bin/env cutes

var vault = require('vault/unit');
var os = require('os');
// var debug= require('debug');
// debug.level('debug');

var info = {
    home : {
        data : [
            { path : 'data/.hidden_dir_self' },
            'data/content/.',
            { path : 'data/file1' },
            { path : 'data/in_dir/file2' },
            { path : 'data/symlink_to_dir' }
        ],
        bin : [
            { path : 'bin/content/.' },
            { path : 'bin/.hidden_dir_self' },
            { path : 'bin/file1' },
            'bin/in_dir/file2',
            'bin/symlink_to_dir'
        ]
    }
};

vault.execute(vault.getopt(), info);
