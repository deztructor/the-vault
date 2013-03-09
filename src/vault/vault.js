/*
 * Backup framework
 *
 * Copyright (C) 2012, 2013 Jolla Ltd.
 * Contact: Denis Zalevskiy <denis.zalevskiy@jollamobile.com>
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.

 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.

 * You should have received a copy of the GNU Lesser General Public
 * License along with this library; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA
 * 02110-1301 USA
 *
 * http://www.gnu.org/licenses/old-licenses/lgpl-2.1.html
 */

require("qtcore.js");

var sys = require("sys.js");
var os = require("os.js");
var subprocess = require("subprocess.js");
var util = require("util.js");
var error = require("error.js");
var debug = require("debug.js");
var git = require("git.js");
var cfg = require('vault/config');

Date.method('toGitTag', function() {
    return this.toISOString().replace(/:/g, '-');
});

var mk_snapshots = function(vcs) {
    var id = function(name) { return '>' + name; }
    , is_id = function(id) { return id.length && id[0] === '>'; }
    , name = function(id) {
        return is_id(id) ? id.substr(1) : undefined;
    }
    , that = Object.create({
        list : function() {
            return util.map(util.filter(vcs.tags(), is_id), name);
        },
        note : function(treeish) { return vcs.notes.get(treeish); },
        activate : function(name) { vcs.checkout(id(name)); },
        tag : function(name) { vcs.tag([id(name)]); }
    });
    return that;
};

var mk_vault = function(path) {

    var vcs = git(path);
    var storage = os.path(path, ".git");
    var blob_storage = os.path(storage, 'blobs');
    var message_file = os.path(path, ".message");
    var snapshots = mk_snapshots(vcs);
    var anchor_file = os.path(path, '.vault');

    var init = function(config) {
        config["status.showUntrackedFiles"] = "all";

        if (!os.mkdir(path))
            error.raise({
                msg : "Can't init vault",
                path : path,
                reason : "directory already exists" });

        try {
            if (vcs.init())
                error.raise({
                    msg : "Can't init git",
                    path : path,
                    stderr : vcs.stderr()});

            if (!os.path.exists(storage))
                error.raise({
                    msg : "Can't find .git",
                    path : path,
                    stderr : vcs.stderr()});

            vcs.config.set(config);
            os.write_file(anchor_file, sys.date().toGitTag());
            vcs.add(anchor_file);
            vcs.commit('anchor');
            vcs.tag(['anchor']);
            os.path.isdir(blob_storage) || os.mkdir(blob_storage);
        } catch (err) {
            os.rmtree(path);
            throw err;
        }
    };

    var exists = function() {
        return os.path.isdir(path);
    };

    var is_invalid = function() {
        if (!os.path.exists(storage))
            return { msg : "Can't find .git"};
        if (!os.path.isfile(anchor_file))
            return { msg : "Can't find .vault anchor"};
        return false;
    };

    var status_dump = function(status) {
        return util.map(status, function(item) {
            return item.toString();
        }).join(', ');
    };

    var tag_as_latest = function() {
        vcs.tag(['-d', '>latest'], true);
        vcs.tag(['>latest']);
    };

    var vault_config = function() {
        return cfg.vault(vcs);
    };

    var blob = function(git_path) {
        var sha = vcs.hash_object(git_path)
        , prefix = sha.slice(0, 2)
        , id = sha.slice(2)
        , blob_dir = os.path(blob_storage, prefix)
        , blob_fname = os.path(blob_dir, id)
        , link_fname = os.path(vcs.root(), git_path);

        var add = function() {
            if (os.path.isfile(blob_fname)) {
                os.unlink(link_fname);
            } else {
                os.rename(link_fname, blob_fname);
            }
            os.symlink(os.path.relative
                       (blob_fname, os.path.dirname(link_fname))
                       , link_fname);
        };

        return Object.create({
            add : add
        });
    };

    /// functionality related to specific unit
    var mk_unit = function(config, home) {
        var name = config.name;
        var root_dir = vcs.path(name);
        var data_dir = root_dir.path("data");
        var blobs_dir = root_dir.path("blobs");
        var mkdir = os.mkdir;

        var reset = function(treeish) {
            vcs.clean(['-fd', '--', name]);
            vcs.reset(['--hard', treeish]);
        };

        /// execute backup script registered for the unit
        var exec_script = function(action) {
            debug.debug('script', config.script, 'action', action);
            if (!os.path.isexec(config.script))
                error.raise({msg : "Should be executable"
                            , script : config.script});
            var args = ['--action', action,
                        '--dir', data_dir.absolute,
                        '--bin-dir', blobs_dir.absolute,
                        '--home-dir', home ];
            debug.info(subprocess.check_output(config.script, args));
        };

        var restore = function() {
            exec_script('import');
        };

        var backup = function() {
            var status, i;

            var is_tree_dirty = function(status) {
                return util.first(status, function(item) {
                    return !item.isTreeClean();
                }) < status.length;
            };

            var isnt_commited = function(status) {
                return util.first(status, function(item) {
                    return !item.isClean();
                }) < status.length;
            };

            // cleanup directories for data and blobs in
            // the repository
            os.rmtree(data_dir.absolute);
            os.rmtree(blobs_dir.absolute);
            mkdir(root_dir.absolute);
            mkdir(data_dir.absolute);
            mkdir(blobs_dir.absolute);

            exec_script('export');

            // save blobs
            util.forEach(vcs.status(blobs_dir.relative), function(status) {
                var git_path = status.src;
                if (status.index == ' ' && status.tree == 'D')
                    return vcs.rm(git_path);

                return blob(git_path).add();
            });

            // commit data
            status = vcs.status(root_dir.relative);
            if (!status.length) {
                debug.info("Nothing to backup for " + name);
                return;
            }

            vcs.add(root_dir.relative, ['-A']);
            status = vcs.status(root_dir.relative);
            if (is_tree_dirty(status))
                error.raise({msg : "Dirty tree",
                             dir : root_dir,
                             status : status_dump(status) });

            vcs.commit(">" + name);

            status = vcs.status(root_dir.relative);
            if (isnt_commited(status))
                error.raise({msg : "Not fully commited",
                             dir : root_dir,
                             status : status_dump(status)});

        };
        return Object.create
        ({ backup : backup,
           restore : restore,
           reset : reset });
    };

    var backup = function(home, options, on_progress) {
        var res = { succeeded :[], failed : [] };
        var config = vault_config();
        var start_time_tag = sys.date().toGitTag();
        var name, message;

        var backup_unit = function(name) {
            var head_before = vcs.rev_parse('HEAD');
            var unit = mk_unit(config.units()[name], home);

            try {
                on_progress({ unit: name, status: "begin" });
                unit.backup();
                on_progress({ unit: name, status: "ok" });
                res.succeeded.push(name);
            } catch (err) {
                err.unit = name;
                debug.error("Failed to backup " + name + ", reason: "
                            + err.toString());
                on_progress({ unit: name, status: "fail" });
                res.failed.push(name);
                unit.reset(head_before);
            }
        };

        vcs.checkout('master');

        if (options && options.units) {
            options.units.each(backup_unit);
        } else {
            config.units().each(function(name, value) {
                return backup_unit(name);
            });
        }

        message = ((options && options.message)
                   ? [start_time_tag, options.message].join('\n')
                   : start_time_tag);
        os.write_file(message_file, message);
        vcs.add(".message");
        vcs.commit([start_time_tag, message].join('\n'));

        snapshots.tag(start_time_tag);
        tag_as_latest();
        vcs.notes.add(options.message || start_time_tag);
        return res;
    };

    var restore = function(home, options, on_progress) {
        var config = vault_config();
        var res = { succeeded :[], failed : [] };
        var name;

        var restore_unit = function(name) {
            var unit = mk_unit(config.units()[name], home);
            try {
                on_progress({ unit: name, status: "begin" });
                unit.restore();
                on_progress({ unit: name, status: "ok" });
                res.succeeded.push(name);
            } catch (err) {
                err.unit = name;
                debug.error("Failed to restore " + name
                            + ", reason: " + err.toString());
                on_progress({ unit: name, status: "fail" });
                res.failed.push(name);
            }
        };

        if (options && options.units) {
            options.units.each(restore_unit);
        } else {
            config.units().each(function(name, value) {
                restore_unit(name);
            });
        }
    };

    var checkout = function(treeish) {
        vcs.checkout(treeish);
    };

    var register = function(config) {
        checkout('master');
        return vault_config().mutable().add(config);
    };

    var unregister = function(unit_name) {
        checkout('master');
        return vault_config().mutable().rm(unit_name);
    };

    var unit_path = function(name) {
        return Object.create({
            bin : vcs.path.curry(name, 'blobs'),
            data : vcs.path.curry(name, 'data')
        });
    };

    return Object.create({
        /// init vault git repository
        init : init,
        exists : exists,
        is_invalid : is_invalid,
        /// perform backup
        backup : backup,
        restore : restore,
        snapshots : snapshots,
        /// returns repository configuration
        config : vault_config,
        checkout : checkout,
        register : register,
        unregister : unregister,
        unit_path : unit_path
    });
};

var parse_kv_pairs = function(cfg) {
    var res = {};
    var pairs, i, kv;
    if (cfg) {
        util.forEach(cfg.split(','), function(v) {
            kv = v.split('=');
            if (kv.length == 2 && kv[0].length)
                res[kv[0]] = kv[1];
        });
    }
    return res;
};

var results = (function() {
    var that = function(obj) {
        var dst = (obj.status === 'ok'
                   ? that.succeeded
                   : that.failed);
        dst.push(obj.unit);
    };

    that.succeeded = [];
    that.failed = [];
    return that;
}).call();

var execute_global = function(options) {
    var action = options.action;
    var config = cfg.system(cfg.global);

    switch (action) {
    case 'register':
        if (!options.data)
            error.raise({ action : action, msg : "Needs data" });

        config.set(parse_kv_pairs(options.data));
        break;
    case 'unregister':
        if (!options.unit)
            error.raise({ action : action, msg : "Needs unit name" });

        config.rm(options.unit);
        break;
    default:
        error.raise({ msg : "Unknown action", action : action});
        break;
    }
};

var execute = function(options) {
    if (options.global)
        return execute_global(options);

    if(!options.vault)
        error.raise({msg : "Missing option", name : "vault"});

    var vault = mk_vault(options.vault);
    var action = options.action;
    var res, units = options.unit ? [options.unit] : undefined;

    switch (action) {
    case 'init':
        res = vault.init(parse_kv_pairs(options.git_config));
        break;
    case 'backup':
        res = vault.backup(options.home,
                           {units : units,
                            message : options.message},
                           results);
        break;
    case 'restore':
        if (!options.tag)
            error.raise({msg : "tag should be provided to restore"});
        vault.snapshots.activate(options.tag);
        res = vault.restore(options.home,
                            {units : units},
                            results);
        break;
    case 'list-snapshots':
        res = vault.snapshots.list();
        print(res.join('\n'));
        break;
    case 'register':
        if (!options.data)
            error.raise({ action : action, msg : "Needs data" });
        vault.register(parse_kv_pairs(options.data));
        break;
    case 'unregister':
        if (!options.unit)
            error.raise({ action : action, msg : "Needs unit name" });
        res = vault.unregister(options.unit);
        break;
    default:
        error.raise({ msg : "Unknown action", action : action});
        break;
    }
    return res;
};

exports = Object.create({
    use : mk_vault,
    execute : execute
});