<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 ZiroEDA and contributors. -->

# How ZiroEDA protects your designs

We built ZiroEDA so that **your projects are readable only by you and the people
you choose to share them with — and by no one else, including us.**

This page explains what that means in plain terms: what is protected, what we
can and cannot see, and the one responsibility that protection puts on you.

## Your projects are end-to-end encrypted

When a project is encrypted, it is scrambled on your own device *before* it is
sent to us, using a key that never leaves your control. What we store on our
servers is unreadable to us. If someone stole our entire database, your designs
would be meaningless noise to them.

This is different from "we promise not to look." We built it so that we
**can't** look — there is no master key on our side that opens your projects.

## What we can and cannot see

**We cannot see:** the contents of your boards, schematics, and files. To us
they are encrypted blobs.

**We can see** some information *about* your activity that isn't the design
itself: that an account exists, that a project changed and roughly how large the
change was, and who a project is shared with. We are telling you this because we
would rather be straight with you than claim we know nothing. What we never see
is what is actually *in* your designs.

## Sharing with your team

When you share a project with someone, your device hands *them* the key to that
one project — again, without us ever seeing it. Everyone you've shared with can
open the project from any of their devices; no one else can, and neither can we.
Remove someone's access and they can no longer open new changes.

## Your recovery key — please save it

Here is the trade-off that makes real privacy possible: because we cannot read
your projects, **we also cannot recover them for you if you lose your keys.**
There is no "reset password and get back in" that reaches your encrypted data,
because that would mean we had a way in all along.

So when you first sign up, we give you a **recovery key** — a one-time code.

- **Save it somewhere safe** (a password manager, or written down and stored
  securely). It is the master key to your own data.
- If you sign in on a new device, you can use it (or approve the new device from
  a device you're already signed in on) to unlock your projects.
- If you ever lose access to all your devices, the recovery key is how you get
  back in.

**If you lose both your devices and your recovery key, your encrypted projects
cannot be recovered by anyone — including us.** That is the cost of the guarantee
that no one but you can read them.

## Using ZiroEDA without the cloud

You don't have to put anything in our cloud at all. You can keep a project local
to your own machine and export it as ordinary files you own. The cloud is there
for convenience — access from anywhere, and real-time collaboration — and it's
your choice, per project.

## It's open source — you don't have to take our word for it

ZiroEDA is open source. The encryption is built on standard, well-studied
cryptography (the same primitives your browser and bank use), and anyone can
read exactly how it works in our code. You can also run the whole thing on your
own server if you'd rather not use ours at all.
